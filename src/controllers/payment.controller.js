const crypto = require("crypto");
const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const PaymentSession = require("../models/PaymentSession");
const WebhookEvent = require("../models/WebhookEvent");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const razorpayService = require("../services/razorpay.service");
const { createOrderId } = require("../services/order.service");
const { calculatePricing } = require("../services/pricing.service");
const { awardPoints, redeemPoints } = require("../services/loyalty.service");
const { processReferralReward } = require("../services/referral.service");
const { sendOrderConfirmation } = require("../services/email.service");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const {
  enrichSpecialDiscounts,
  createOrderFromSession,
  postOrderActions,
} = require("../services/checkout.service");
const { releaseStock } = require("../services/stock.service");
const { parsePhone, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");
const resolveItemPrice = require("../utils/resolveItemPrice");
const SpinWheelEntry = require("../models/SpinWheelEntry");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes",
};

// POST /api/payments/razorpay/create
const createRazorpayOrder = asyncHandler(async (req, res) => {
  const {
    shippingInfo,
    billingInfo,
    billingSameAsShipping,
    couponCode,
    specialCouponCode,
    giftWrap,
    giftMessage,
    loyaltyPointsToRedeem = 0,
  } = req.body;

  // Normalise phone in shippingInfo
  if (shippingInfo?.phone) {
    const parsedPhone = parsePhone(shippingInfo.phone);
    if (parsedPhone) {
      shippingInfo.phone = parsedPhone.number;
      shippingInfo.countryCode = shippingInfo.countryCode || parsedPhone.countryCode || DEFAULT_COUNTRY_CODE;
    }
  }

  // Get user's cart
  const cart = await Cart.findOne({ user: req.user._id }).populate(POPULATE_PRODUCT);

  if (!cart || !cart.items.length) {
    throw ApiError.badRequest("Cart is empty");
  }

  // Calculate pricing (with special coupons + loyalty)
  const pricing = await calculatePricing(
    cart,
    couponCode,
    req.user._id,
    giftWrap,
    specialCouponCode,
    Number(loyaltyPointsToRedeem) || 0,
    { pincode: shippingInfo?.pincode, state: shippingInfo?.state },
    "razorpay"
  );

  // Create Razorpay order (amount in paise)
  const amountInPaise = Math.round(pricing.total * 100);
  const receipt = `rcpt_${req.user._id}_${Date.now()}`;

  const razorpayOrder = await razorpayService.createOrder(
    amountInPaise,
    "INR",
    receipt
  );

  res.json(
    ApiResponse.ok({
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: "INR",
      pricing,
    })
  );
});

// POST /api/payments/razorpay/verify
const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    shippingInfo,
    billingInfo,
    billingSameAsShipping = true,
    couponCode,
    specialCouponCode,
    giftWrap,
    giftMessage,
    loyaltyPointsToRedeem = 0,
  } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest("Payment verification details are required");
  }

  // Normalise phone in shippingInfo
  if (shippingInfo?.phone) {
    const parsedPhone = parsePhone(shippingInfo.phone);
    if (parsedPhone) {
      shippingInfo.phone = parsedPhone.number;
      shippingInfo.countryCode = shippingInfo.countryCode || parsedPhone.countryCode || DEFAULT_COUNTRY_CODE;
    }
  }

  // Verify signature
  const isValid = razorpayService.verifyPayment(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!isValid) {
    throw ApiError.badRequest("Payment verification failed");
  }

  // Get user's cart
  const cart = await Cart.findOne({ user: req.user._id }).populate(POPULATE_PRODUCT);

  if (!cart || !cart.items.length) {
    throw ApiError.badRequest("Cart is empty");
  }

  // Calculate pricing (with special coupons + loyalty)
  const pricing = await calculatePricing(
    cart,
    couponCode,
    req.user._id,
    giftWrap,
    specialCouponCode,
    Number(loyaltyPointsToRedeem) || 0,
    { pincode: shippingInfo?.pincode, state: shippingInfo?.state },
    "razorpay"
  );

  // Generate order ID
  const orderId = await createOrderId();

  // Build order items
  const orderItems = cart.items.map((item) => {
    const primaryImage = item.product.images?.find((img) => img.isPrimary);
    return {
      product: item.product._id,
      name: item.product.name,
      price: resolveItemPrice(item.product, item.selectedSize),
      quantity: item.quantity,
      selectedSize: item.selectedSize,
      image: primaryImage?.url || item.product.images?.[0]?.url || "",
    };
  });

  // Add free gift items from special promotions
  if (pricing.freeGifts && pricing.freeGifts.length > 0) {
    for (const gift of pricing.freeGifts) {
      const giftProduct = await Product.findById(gift.productId).select("name images").lean();
      if (giftProduct) {
        const primaryImage = giftProduct.images?.find((img) => img.isPrimary);
        orderItems.push({
          product: gift.productId,
          name: giftProduct.name,
          price: 0,
          quantity: gift.quantity || 1,
          selectedSize: gift.variantSize || undefined,
          image: primaryImage?.url || giftProduct.images?.[0]?.url || "",
          isFreeGift: true,
        });
      }
    }
  }

  // Redeem loyalty points BEFORE creating the order so we can fail fast.
  // The atomic decrement guards against insufficient balance / race conditions.
  // If the user spent points elsewhere between pricing calc and now, this rejects.
  let loyaltyRedemptionTx = null;
  if (pricing.loyaltyPointsRedeemed > 0) {
    loyaltyRedemptionTx = await redeemPoints(
      req.user._id,
      pricing.loyaltyPointsRedeemed,
      null, // order id not yet known
      `Redeemed ${pricing.loyaltyPointsRedeemed} points (pending order ${orderId})`
    );
    if (!loyaltyRedemptionTx) {
      throw ApiError.conflict(
        "Insufficient loyalty points balance. Please refresh and retry."
      );
    }
  }

  // Create order
  let order;
  try {
    order = await Order.create({
    orderId,
    user: req.user._id,
    items: orderItems,
    shippingAddress: shippingInfo,
    billingAddress: billingSameAsShipping ? shippingInfo : billingInfo,
    billingSameAsShipping,
    payment: {
      method: "razorpay",
      razorpayOrderId,
      razorpayPaymentId,
      status: "paid",
    },
    pricing: {
      subtotal: pricing.subtotal,
      bundleDiscounts: pricing.bundleDiscounts,
      bundleDiscountTotal: pricing.bundleDiscountTotal,
      tierDiscount: pricing.tierDiscount,
      tierPercent: pricing.tierPercent,
      tierLabel: pricing.tierLabel,
      specialCouponDiscounts: await enrichSpecialDiscounts(pricing.specialCouponDiscounts),
      specialCouponDiscountTotal: pricing.specialCouponDiscountTotal || 0,
      couponDiscount: pricing.couponDiscount,
      couponCode: pricing.couponCode,
      shippingCost: pricing.shippingCost,
      giftWrapCost: pricing.giftWrapCost,
      loyaltyDiscount: pricing.loyaltyDiscount || 0,
      loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed || 0,
      total: pricing.total,
    },
    giftWrap: giftWrap || false,
    giftMessage,
    contactEmail: shippingInfo.email,
    contactPhone: shippingInfo.phone,
    status: "confirmed",
    confirmedAt: new Date(),
    loyaltyPointsEarned: pricing.loyaltyPoints,
    adminNotes: [
      {
        actor: "customer",
        event: "order:placed",
        note: "Customer placed the order (paid online)",
        addedBy: req.user._id,
        addedAt: new Date(),
      },
      {
        actor: "system",
        event: "payment:paid",
        note: "Payment received (Razorpay)",
        addedAt: new Date(),
      },
    ],
  });
  } catch (orderErr) {
    // Compensate the loyalty redemption that we already committed
    if (loyaltyRedemptionTx) {
      try {
        await User.findByIdAndUpdate(req.user._id, {
          $inc: { loyaltyPoints: pricing.loyaltyPointsRedeemed },
        });
        await LoyaltyTransaction.deleteOne({ _id: loyaltyRedemptionTx._id });
      } catch (compErr) {
        console.error(
          `CRITICAL: failed to compensate loyalty redemption for failed order ${orderId}: ${compErr.message}`
        );
      }
    }
    throw orderErr;
  }

  // Link the loyalty redemption transaction to the now-created order
  if (loyaltyRedemptionTx) {
    try {
      await LoyaltyTransaction.updateOne(
        { _id: loyaltyRedemptionTx._id },
        {
          $set: {
            order: order._id,
            description: `Redeemed ${pricing.loyaltyPointsRedeemed} points on order ${orderId}`,
          },
        }
      );
    } catch (linkErr) {
      // Non-critical: link failure means the txn shows "pending order" description
      console.error("Loyalty redemption link error:", linkErr.message);
    }
  }

  // Update regular coupon usage if a coupon was applied
  if (pricing.couponCode) {
    await Coupon.findOneAndUpdate(
      { code: pricing.couponCode },
      {
        $inc: { usageCount: 1 },
        $push: { usedBy: { user: req.user._id, usedAt: new Date() } },
      }
    );

    // Sync spin wheel entry redemption
    if (pricing.couponCode.startsWith("SPIN-")) {
      await SpinWheelEntry.findOneAndUpdate(
        { couponCode: pricing.couponCode },
        { isRedeemed: true, redeemedAt: new Date(), user: req.user._id }
      );
    }
  }

  // Update special coupon usage atomically with limit check
  if (pricing.specialCouponDiscounts && pricing.specialCouponDiscounts.length > 0) {
    for (const sp of pricing.specialCouponDiscounts) {
      const updateFilter = { _id: sp.specialCouponId };
      const promo = await SpecialCoupon.findById(sp.specialCouponId).select("usageLimit").lean();
      if (promo?.usageLimit) {
        updateFilter.usageCount = { $lt: promo.usageLimit };
      }
      await SpecialCoupon.findOneAndUpdate(updateFilter, {
        $inc: { usageCount: 1 },
        $push: { usedBy: { user: req.user._id, usedAt: new Date() } },
      });
    }
  }

  // Clear cart
  cart.items = [];
  cart.giftWrap = false;
  cart.giftMessage = "";
  await cart.save();

  // Award loyalty points
  await awardPoints(
    req.user._id,
    pricing.loyaltyPoints,
    order._id,
    `Earned ${pricing.loyaltyPoints} points from order ${orderId}`
  );

  // Process referral reward (best-effort)
  try {
    await processReferralReward(order._id, req.user._id);
  } catch (err) {
    console.error("Referral reward error:", err.message);
  }

  // Queue adhoc Shiprocket order creation (best-effort, non-blocking).
  const { scheduleShiprocketCreate } = require("../jobs/createShiprocketOrder");
  await scheduleShiprocketCreate(order._id);

  // Order confirmation email (best-effort).
  try {
    const to = order.shippingAddress?.email;
    if (to) await sendOrderConfirmation(to, order);
  } catch (err) {
    console.error(`Confirmation email failed for ${order.orderId}:`, err.message);
  }

  res.json(ApiResponse.created({ order }, "Order placed successfully"));
});

// POST /api/payments/webhook
// Session-aware, idempotent webhook handler.
//
// Flow: verify signature over the RAW body -> dedup on x-razorpay-event-id ->
// dispatch -> record event id on success. Handlers complete normally on success
// or permanent no-op; they THROW on transient failures so this wrapper responds
// 5xx and Razorpay retries (the dedup record is only written after success, so a
// retry reprocesses cleanly).
//
// Handles: payment.captured, order.paid, payment.authorized, payment.failed,
//          refund.created, refund.processed, refund.failed
const handleWebhook = async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  // 1. Signature must be present and the raw body captured (server.js verify hook)
  if (!signature || !webhookSecret || !req.rawBody) {
    return res.status(400).json({ error: "Missing signature or secret" });
  }

  // 2. Verify signature over the RAW request bytes (never re-serialized JSON),
  //    using a constant-time comparison.
  let validSignature = false;
  try {
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.rawBody)
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signature, "utf8");
    validSignature =
      expectedBuf.length === signatureBuf.length &&
      crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    validSignature = false;
  }

  if (!validSignature) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = req.body.event;
  const payload = req.body.payload;
  const eventId = req.headers["x-razorpay-event-id"];

  console.log(
    `[Webhook] Event: ${event}, EventId: ${eventId || "none"}, OrderId: ${
      payload?.payment?.entity?.order_id ||
      payload?.refund?.entity?.payment_id ||
      "unknown"
    }`
  );

  // 3. Idempotency: skip events we have already fully processed (Razorpay
  //    retries and may deliver duplicates).
  if (eventId) {
    const seen = await WebhookEvent.exists({ eventId });
    if (seen) {
      return res.status(200).json({ status: "ok", duplicate: true });
    }
  }

  // 4. Dispatch. Throws => transient failure => 5xx so Razorpay retries.
  try {
    await processWebhookEvent(event, payload);
  } catch (err) {
    console.error(`Webhook processing error (${event}):`, err.message);
    return res.status(500).json({ error: "Processing failed" });
  }

  // 5. Record the event id so future deliveries short-circuit (step 3).
  //    Tolerate the race where a concurrent delivery inserted it first.
  if (eventId) {
    try {
      await WebhookEvent.create({ eventId, event });
    } catch (err) {
      if (err.code !== 11000) {
        console.error("Webhook dedup record error:", err.message);
      }
    }
  }

  return res.status(200).json({ status: "ok" });
};

/**
 * Dispatch a verified, de-duplicated webhook event.
 * Returns on success or permanent no-op; throws on transient failures
 * (so the caller responds 5xx and Razorpay retries).
 */
const processWebhookEvent = async (event, payload) => {
  // --- payment.captured / order.paid ---
  // (order.paid payload also carries payload.payment.entity)
  if (event === "payment.captured" || event === "order.paid") {
    const razorpayPaymentId = payload.payment.entity.id;
    const razorpayOrderId = payload.payment.entity.order_id;

    const session = await PaymentSession.findOne({ razorpayOrderId });

    if (!session) {
      // Legacy order or test event -- fallback to direct order update
      await Order.findOneAndUpdate(
        { "payment.razorpayOrderId": razorpayOrderId },
        {
          "payment.razorpayPaymentId": razorpayPaymentId,
          "payment.status": "paid",
          status: "confirmed",
        }
      );
      return;
    }

    if (session.status === "completed") {
      // Order already created -- ensure payment fields are correct
      await Order.findOneAndUpdate(
        { paymentSession: session._id },
        {
          "payment.razorpayPaymentId": razorpayPaymentId,
          "payment.status": "paid",
        }
      );
      return;
    }

    if (session.status === "processing") {
      // The confirm endpoint is already creating the order
      return;
    }

    if (session.status === "pending") {
      // Client confirm either failed or hasn't arrived. Create the order.
      const locked = await PaymentSession.findOneAndUpdate(
        { _id: session._id, status: "pending" },
        { $set: { status: "processing" } },
        { new: true }
      );

      if (!locked) return;

      // Verify the captured amount matches the frozen session amount.
      let rzpOrder;
      try {
        rzpOrder = await razorpayService.fetchOrder(razorpayOrderId);
      } catch (err) {
        // Transient: revert and let Razorpay retry.
        await PaymentSession.findByIdAndUpdate(locked._id, { status: "pending" });
        throw new Error(`fetchOrder failed: ${err.message}`);
      }

      if (rzpOrder.amount !== locked.amountInPaise) {
        // Permanent mismatch: do not create the order, revert, acknowledge.
        console.error(
          `Webhook amount mismatch: Razorpay=${rzpOrder.amount}, Session=${locked.amountInPaise}`
        );
        await PaymentSession.findByIdAndUpdate(locked._id, { status: "pending" });
        return;
      }

      const mongoSession = await mongoose.startSession();
      let createErr = null;
      try {
        mongoSession.startTransaction();
        const order = await createOrderFromSession(
          locked,
          { method: "razorpay", razorpayOrderId, razorpayPaymentId },
          mongoSession
        );
        await mongoSession.commitTransaction();
        await postOrderActions(order, locked);
      } catch (err) {
        await mongoSession.abortTransaction();
        await PaymentSession.findByIdAndUpdate(locked._id, { status: "pending" });
        createErr = err;
      } finally {
        mongoSession.endSession();
      }

      if (createErr) {
        // Transient: retry.
        throw new Error(`Order creation failed: ${createErr.message}`);
      }
      return;
    }

    // expired or failed session -- log for investigation, acknowledge.
    console.error(
      `Webhook: ${event} for session in status "${session.status}" (session: ${session._id})`
    );
    return;
  }

  // --- payment.authorized ---
  // Standard checkout auto-captures; authorization is an intermediate state.
  // Capture handling happens on payment.captured. Acknowledge only.
  if (event === "payment.authorized") {
    return;
  }

  // --- payment.failed ---
  if (event === "payment.failed") {
    const razorpayOrderId = payload.payment.entity.order_id;

    // Atomic transition: only process if still pending
    const session = await PaymentSession.findOneAndUpdate(
      { razorpayOrderId, status: "pending" },
      { $set: { status: "failed" } },
      { new: true }
    );

    if (!session) {
      // No session or already handled -- fallback for legacy orders
      const existingSession = await PaymentSession.findOne({ razorpayOrderId });
      if (!existingSession) {
        await Order.findOneAndUpdate(
          { "payment.razorpayOrderId": razorpayOrderId },
          { "payment.status": "failed", status: "cancelled" }
        );
      }
      return;
    }

    // Release reserved stock
    await releaseStock(session.stockReservations);

    // Cancel Agenda expiry job
    if (session.agendaJobId) {
      try {
        const agenda = require("../config/agenda");
        await agenda.cancel({
          _id: new mongoose.Types.ObjectId(session.agendaJobId),
        });
      } catch {
        // Non-critical
      }
    }

    return;
  }

  // --- refund.created ---
  if (event === "refund.created") {
    const refundEntity = payload.refund.entity;
    const order = await Order.findOne({
      "payment.razorpayPaymentId": refundEntity.payment_id,
    });
    if (!order) return;

    const entry = order.payment.refunds?.find(
      (r) => r.refundId === refundEntity.id
    );
    // Only advance a not-yet-terminal entry to "initiated".
    if (entry && entry.status !== "processed" && entry.status !== "failed") {
      entry.status = "initiated";
      await order.save();
    }
    return;
  }

  // --- refund.processed ---
  if (event === "refund.processed") {
    const refundEntity = payload.refund.entity;
    const paymentId = refundEntity.payment_id;
    const refundId = refundEntity.id;

    const order = await Order.findOne({
      "payment.razorpayPaymentId": paymentId,
    });
    if (!order) return;

    const refundEntry = order.payment.refunds?.find(
      (r) => r.refundId === refundId
    );
    if (refundEntry) {
      refundEntry.status = "processed";
    }

    // Determine if full or partial (count this refund even if the entry was missing)
    const totalPaise = Math.round(order.pricing.total * 100);
    const totalRefundedPaise = (order.payment.refunds || [])
      .filter((r) => r.status === "processed" || r.refundId === refundId)
      .reduce((sum, r) => sum + (r.amount || 0), 0);

    if (totalRefundedPaise >= totalPaise) {
      order.payment.status = "refunded";
      order.status = "refunded";
    } else {
      order.payment.status = "partially_refunded";
    }

    await order.save();
    return;
  }

  // --- refund.failed ---
  if (event === "refund.failed") {
    const refundEntity = payload.refund.entity;
    const order = await Order.findOne({
      "payment.razorpayPaymentId": refundEntity.payment_id,
    });
    if (!order) return;

    const refundEntry = order.payment.refunds?.find(
      (r) => r.refundId === refundEntity.id
    );
    if (refundEntry) {
      refundEntry.status = "failed";
    }

    // Recompute payment status from the refunds that actually succeeded.
    const totalPaise = Math.round(order.pricing.total * 100);
    const processedPaise = (order.payment.refunds || [])
      .filter((r) => r.status === "processed")
      .reduce((sum, r) => sum + (r.amount || 0), 0);

    if (processedPaise <= 0) {
      order.payment.status = "paid";
    } else if (processedPaise >= totalPaise) {
      order.payment.status = "refunded";
    } else {
      order.payment.status = "partially_refunded";
    }

    await order.save();
    return;
  }

  // Unhandled event -- acknowledge so Razorpay stops retrying.
  console.log(`[Webhook] Unhandled event: ${event}`);
};

module.exports = { createRazorpayOrder, verifyRazorpayPayment, handleWebhook };
