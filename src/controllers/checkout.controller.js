const mongoose = require("mongoose");
const PaymentSession = require("../models/PaymentSession");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const Order = require("../models/Order");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { calculatePricing } = require("../services/pricing.service");
const { reserveStock, releaseStock, validateStock } = require("../services/stock.service");
const razorpayService = require("../services/razorpay.service");
const {
  createOrderFromSession,
  postOrderActions,
  enrichSpecialDiscounts,
} = require("../services/checkout.service");
const { parsePhone, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");
const { SESSION_TTL_MINUTES } = require("../utils/constants");
const resolveItemPrice = require("../utils/resolveItemPrice");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes",
};

/**
 * POST /api/checkout/initiate
 * Validates cart, calculates pricing, reserves stock, creates Razorpay order,
 * and returns a PaymentSession for the frontend to complete payment.
 */
const initiateCheckout = asyncHandler(async (req, res) => {
  const {
    shippingInfo,
    billingInfo,
    billingSameAsShipping = true,
    couponCode,
    specialCouponCode,
    giftWrap,
    giftMessage,
    idempotencyKey,
    loyaltyPointsToRedeem = 0,
  } = req.body;

  // Normalize phone
  if (shippingInfo?.phone) {
    const parsedPhone = parsePhone(shippingInfo.phone);
    if (parsedPhone) {
      shippingInfo.phone = parsedPhone.number;
      shippingInfo.countryCode =
        shippingInfo.countryCode || parsedPhone.countryCode || DEFAULT_COUNTRY_CODE;
    }
  }

  // 1. Idempotency check
  const existingSession = await PaymentSession.findOne({
    idempotencyKey,
    user: req.user._id,
  });

  if (existingSession) {
    if (
      existingSession.status === "pending" &&
      existingSession.expiresAt > new Date()
    ) {
      // If session exists but has no razorpayOrderId, it's orphaned from a
      // failed Razorpay API call. Clean it up and proceed with a new session.
      if (!existingSession.razorpayOrderId) {
        await releaseStock(existingSession.stockReservations);
        await PaymentSession.findByIdAndDelete(existingSession._id);
      } else {
        return res.json(
          ApiResponse.ok({
            sessionId: existingSession._id,
            razorpayOrderId: existingSession.razorpayOrderId,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            amount: existingSession.amountInPaise,
            currency: "INR",
            pricing: existingSession.pricing,
          })
        );
      }
    }
    if (existingSession.status === "completed") {
      throw ApiError.conflict("Order already placed for this checkout session");
    }
    // expired/failed/orphaned -- allow proceeding with new session
  }

  // 1b. Guard against multiple concurrent pending sessions
  const activeSessions = await PaymentSession.countDocuments({
    user: req.user._id,
    status: "pending",
    expiresAt: { $gt: new Date() },
    idempotencyKey: { $ne: idempotencyKey },
  });
  if (activeSessions > 0) {
    throw ApiError.conflict(
      "You already have an active checkout session. Please complete or wait for it to expire before starting a new one."
    );
  }

  // 2. Load cart
  const cart = await Cart.findOne({ user: req.user._id }).populate(
    POPULATE_PRODUCT
  );

  if (!cart || !cart.items.length) {
    throw ApiError.badRequest("Cart is empty");
  }

  // 3. Validate stock (early warning)
  const stockCheck = await validateStock(cart.items);
  if (!stockCheck.valid) {
    throw ApiError.conflict(
      "Some items are out of stock",
      stockCheck.insufficientItems
    );
  }

  // 4. Calculate pricing (with loyalty redemption)
  const pricing = await calculatePricing(
    cart,
    couponCode || null,
    req.user._id,
    giftWrap || false,
    specialCouponCode || null,
    Number(loyaltyPointsToRedeem) || 0,
    { pincode: shippingInfo?.pincode, state: shippingInfo?.state }
  );

  const amountInPaise = Math.round(pricing.total * 100);

  if (amountInPaise <= 0) {
    throw ApiError.badRequest(
      "Order total must be greater than zero for online payment"
    );
  }

  // 5. Build frozen cart snapshot
  const cartSnapshot = cart.items.map((item) => {
    const primaryImage = item.product.images?.find((img) => img.isPrimary);
    return {
      product: item.product._id,
      name: item.product.name,
      price: resolveItemPrice(item.product, item.selectedSize),
      quantity: item.quantity,
      selectedSize: item.selectedSize || undefined,
      image: primaryImage?.url || item.product.images?.[0]?.url || "",
    };
  });

  // 6. Enrich special discounts for the snapshot
  const enrichedSpecialDiscounts = await enrichSpecialDiscounts(
    pricing.specialCouponDiscounts
  );

  // 6b. Check free gift stock -- remove out-of-stock gifts
  let availableFreeGifts = [];
  if (pricing.freeGifts && pricing.freeGifts.length > 0) {
    for (const gift of pricing.freeGifts) {
      const giftProduct = await Product.findById(gift.productId)
        .select("sizes isActive")
        .lean();

      if (!giftProduct || !giftProduct.isActive) continue;

      // Check if the gift has stock in the requested variant (or any variant)
      const variantSize = gift.variantSize;
      let hasStock = false;

      if (variantSize) {
        const sizeEntry = giftProduct.sizes?.find((s) => s.label === variantSize);
        hasStock = sizeEntry && sizeEntry.stock >= (gift.quantity || 1);
      } else {
        // No specific variant -- check if any size has enough stock
        hasStock = giftProduct.sizes?.some(
          (s) => s.stock >= (gift.quantity || 1)
        );
      }

      if (hasStock) {
        availableFreeGifts.push(gift);
      }
      // Out-of-stock gifts are silently excluded. The promotion discount
      // still applies -- only the physical gift is skipped.
    }
  }

  // 7. Build frozen pricing object
  const frozenPricing = {
    subtotal: pricing.subtotal,
    bundleDiscounts: pricing.bundleDiscounts,
    bundleDiscountTotal: pricing.bundleDiscountTotal,
    tierDiscount: pricing.tierDiscount,
    tierPercent: pricing.tierPercent,
    tierLabel: pricing.tierLabel,
    specialCouponDiscounts: enrichedSpecialDiscounts,
    specialCouponDiscountTotal: pricing.specialCouponDiscountTotal || 0,
    couponDiscount: pricing.couponDiscount,
    couponCode: pricing.couponCode,
    shippingCost: pricing.shippingCost,
    giftWrapCost: pricing.giftWrapCost,
    loyaltyDiscount: pricing.loyaltyDiscount || 0,
    loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed || 0,
    total: pricing.total,
    loyaltyPoints: pricing.loyaltyPoints,
    freeGifts: availableFreeGifts,
  };

  // 8. Build stock reservation items (skip products without sizes)
  const stockItems = cart.items
    .map((item) => ({
      productId: item.product._id,
      sizeLabel: item.selectedSize || item.product.sizes?.[0]?.label,
      quantity: item.quantity,
    }))
    .filter((item) => item.sizeLabel);

  // 9. Reserve stock within a transaction and create session
  const mongoSession = await mongoose.startSession();
  let session;
  let reservations;

  try {
    mongoSession.startTransaction();

    reservations = await reserveStock(stockItems, mongoSession);

    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

    [session] = await PaymentSession.create(
      [
        {
          user: req.user._id,
          cart: { items: cartSnapshot },
          pricing: frozenPricing,
          couponCode: couponCode || null,
          specialCouponCode: specialCouponCode || null,
          giftWrap: giftWrap || false,
          giftMessage: giftMessage || undefined,
          shippingAddress: shippingInfo,
          billingAddress: billingSameAsShipping ? shippingInfo : billingInfo,
          billingSameAsShipping,
          amountInPaise,
          status: "pending",
          idempotencyKey,
          stockReservations: reservations,
          expiresAt,
        },
      ],
      { session: mongoSession }
    );

    await mongoSession.commitTransaction();
  } catch (err) {
    await mongoSession.abortTransaction();
    throw err;
  } finally {
    mongoSession.endSession();
  }

  // 10. Create Razorpay order (outside transaction -- external API call)
  let razorpayOrder;
  try {
    razorpayOrder = await razorpayService.createOrder(
      amountInPaise,
      "INR",
      `sess_${session._id}`
    );
  } catch (err) {
    // Razorpay failed: release stock and clean up session
    await releaseStock(reservations);
    await PaymentSession.findByIdAndDelete(session._id);
    throw ApiError.internal("Payment gateway unavailable. Please try again.");
  }

  // 11. Update session with Razorpay order ID
  session.razorpayOrderId = razorpayOrder.id;

  // 12. Schedule Agenda expiry job
  try {
    const agenda = require("../config/agenda");
    const job = await agenda.schedule(
      session.expiresAt,
      "expire-payment-session",
      { sessionId: session._id.toString() }
    );
    session.agendaJobId = job.attrs._id.toString();
  } catch (err) {
    // Non-critical: session will still expire but without automatic cleanup
  }

  await session.save();

  // 13. Return response
  res.json(
    ApiResponse.ok({
      sessionId: session._id,
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: "INR",
      pricing: frozenPricing,
    })
  );
});

/**
 * POST /api/checkout/confirm
 * Verifies Razorpay payment, creates Order atomically from frozen session snapshot.
 */
const confirmCheckout = asyncHandler(async (req, res) => {
  const { sessionId, razorpayOrderId, razorpayPaymentId, razorpaySignature } =
    req.body;

  // 1. Atomic status transition: pending -> processing
  const session = await PaymentSession.findOneAndUpdate(
    {
      _id: sessionId,
      razorpayOrderId,
      user: req.user._id,
      status: "pending",
    },
    { $set: { status: "processing" } },
    { new: true }
  );

  if (!session) {
    // Determine why
    const existing = await PaymentSession.findOne({
      _id: sessionId,
      user: req.user._id,
    });

    if (!existing) {
      throw ApiError.notFound("Payment session not found");
    }
    if (existing.status === "completed") {
      const order = await Order.findById(existing.orderId);
      return res.json(ApiResponse.ok({ order }, "Order already placed"));
    }
    if (existing.status === "processing") {
      throw ApiError.conflict(
        "Order creation in progress. Please check My Orders."
      );
    }
    if (existing.status === "expired" || existing.status === "failed") {
      throw ApiError.gone("Payment session has expired. Please start a new checkout.");
    }
    throw ApiError.badRequest("Invalid session state");
  }

  // 2. Verify Razorpay signature
  const isValidSignature = razorpayService.verifyPayment(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!isValidSignature) {
    // Revert session to pending so webhook can still process
    session.status = "pending";
    await session.save();
    throw ApiError.badRequest("Payment verification failed");
  }

  // 3. Verify amount
  let rzpOrder;
  try {
    rzpOrder = await razorpayService.fetchOrder(razorpayOrderId);
  } catch (err) {
    session.status = "pending";
    await session.save();
    throw ApiError.internal("Unable to verify payment amount");
  }

  if (
    rzpOrder.amount !== session.amountInPaise ||
    (rzpOrder.amount_paid && rzpOrder.amount_paid !== session.amountInPaise)
  ) {
    session.status = "pending";
    await session.save();
    throw ApiError.badRequest("Payment amount mismatch");
  }

  // 4. Create order atomically
  const mongoSession = await mongoose.startSession();
  let order;

  try {
    mongoSession.startTransaction();

    order = await createOrderFromSession(
      session,
      {
        method: "razorpay",
        razorpayOrderId,
        razorpayPaymentId,
      },
      mongoSession
    );

    await mongoSession.commitTransaction();
  } catch (err) {
    await mongoSession.abortTransaction();
    // Revert session to pending so webhook can retry
    await PaymentSession.findByIdAndUpdate(session._id, {
      status: "pending",
    });
    throw err;
  } finally {
    mongoSession.endSession();
  }

  // 5. Post-transaction actions (non-critical)
  await postOrderActions(order, session);

  // Order summary over WhatsApp (best-effort; prepaid is confirmed on payment).
  try {
    await require("../services/whatsapp.service").sendOrderSummary(order);
  } catch (err) {
    console.error(`[WhatsApp] order summary failed for ${order.orderId}:`, err.message);
  }

  res.status(201).json(
    ApiResponse.created({ order }, "Order placed successfully")
  );
});

module.exports = { initiateCheckout, confirmCheckout };
