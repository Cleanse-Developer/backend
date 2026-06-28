const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const Product = require("../models/Product");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { createOrderId, runCodPostActions } = require("../services/order.service");
const whatsappService = require("../services/whatsapp.service");
const env = require("../config/env");
const { calculatePricing } = require("../services/pricing.service");
const { reversePoints } = require("../services/loyalty.service");
const { reverseReferralReward } = require("../services/referral.service");
const { enrichSpecialDiscounts } = require("../services/checkout.service");
const { validateStock, reserveStock } = require("../services/stock.service");
const { backfillUserProfile } = require("../services/profile.service");
const { logActivity, ACTORS } = require("../utils/orderActivity");
const { cancelOrder: cancelShiprocketOrder, cancelShipment: cancelShiprocketShipment } = require("../services/shiprocket.service");
const razorpayService = require("../services/razorpay.service");
const { parsePhone, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");
const SpinWheelEntry = require("../models/SpinWheelEntry");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes",
};

// Resolve a user's order by either its Mongo _id or its human-readable orderId.
// The frontend sends order._id, while older clients/links may send the orderId.
const findUserOrder = (param, userId) => {
  const conditions = [{ orderId: param }];
  if (mongoose.Types.ObjectId.isValid(param)) {
    conditions.push({ _id: param });
  }
  return Order.findOne({ user: userId, $or: conditions });
};

// POST /api/orders — place order (COD only; Razorpay handled in payment controller)
const placeOrder = asyncHandler(async (req, res) => {
  const {
    shippingInfo,
    billingInfo,
    billingSameAsShipping = true,
    paymentMethod,
    couponCode,
    specialCouponCode,
    giftWrap,
    giftMessage,
    loyaltyPointsToRedeem = 0,
  } = req.body;

  if (paymentMethod !== "cod") {
    throw ApiError.badRequest(
      "Only COD orders can be placed through this endpoint. Use the payment API for Razorpay."
    );
  }

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

  // Validate stock availability
  const stockCheck = await validateStock(cart.items);
  if (!stockCheck.valid) {
    throw ApiError.conflict("Some items are out of stock", stockCheck.insufficientItems);
  }

  // Calculate pricing (now includes special coupons + loyalty redemption)
  const pricing = await calculatePricing(
    cart,
    couponCode,
    req.user._id,
    giftWrap,
    specialCouponCode,
    Number(loyaltyPointsToRedeem) || 0,
    { pincode: shippingInfo?.pincode, state: shippingInfo?.state }
  );

  // Build stock reservation items
  const stockItems = cart.items.map((item) => ({
    productId: item.product._id,
    sizeLabel: item.selectedSize || item.product.sizes?.[0]?.label,
    quantity: item.quantity,
  })).filter((item) => item.sizeLabel);

  // Generate order ID
  const orderId = await createOrderId();

  // Build order items
  const orderItems = cart.items.map((item) => {
    const primaryImage = item.product.images?.find((img) => img.isPrimary);
    return {
      product: item.product._id,
      name: item.product.name,
      price: item.product.price,
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

  // All critical operations inside a transaction
  const mongoSession = await mongoose.startSession();
  let order;

  try {
    mongoSession.startTransaction();

    // 1. Reserve stock atomically
    await reserveStock(stockItems, mongoSession);

    // 2. Create order
    [order] = await Order.create(
      [
        {
          orderId,
          user: req.user._id,
          items: orderItems,
          shippingAddress: shippingInfo,
          billingAddress: billingSameAsShipping ? shippingInfo : billingInfo,
          billingSameAsShipping,
          payment: {
            method: "cod",
            status: "pending",
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
          status: "pending",
          loyaltyPointsEarned: pricing.loyaltyPoints,
          adminNotes: [
            {
              actor: ACTORS.CUSTOMER,
              event: "order:placed",
              note: "Customer placed the order (Cash on Delivery)",
              addedBy: req.user._id,
              addedAt: new Date(),
            },
          ],
        },
      ],
      { session: mongoSession }
    );

    // 3. Update regular coupon usage with atomic $lt guard
    if (pricing.couponCode) {
      const coupon = await Coupon.findOne({ code: pricing.couponCode })
        .select("usageLimit")
        .lean()
        .session(mongoSession);
      const couponFilter = { code: pricing.couponCode };
      if (coupon?.usageLimit) {
        couponFilter.usageCount = { $lt: coupon.usageLimit };
      }
      const couponResult = await Coupon.findOneAndUpdate(
        couponFilter,
        {
          $inc: { usageCount: 1 },
          $push: { usedBy: { user: req.user._id, usedAt: new Date() } },
        },
        { session: mongoSession }
      );

      if (!couponResult && coupon?.usageLimit) {
        throw ApiError.conflict("Coupon usage limit reached. Please remove the coupon and try again.");
      }

      // Sync spin wheel entry redemption
      if (pricing.couponCode.startsWith("SPIN-")) {
        await SpinWheelEntry.findOneAndUpdate(
          { couponCode: pricing.couponCode },
          { isRedeemed: true, redeemedAt: new Date(), user: req.user._id },
          { session: mongoSession }
        );
      }
    }

    // 4. Update special coupon usage atomically with limit check
    if (pricing.specialCouponDiscounts && pricing.specialCouponDiscounts.length > 0) {
      for (const sp of pricing.specialCouponDiscounts) {
        const updateFilter = { _id: sp.specialCouponId };
        const promo = await SpecialCoupon.findById(sp.specialCouponId)
          .select("usageLimit")
          .lean()
          .session(mongoSession);
        if (promo?.usageLimit) {
          updateFilter.usageCount = { $lt: promo.usageLimit };
        }
        await SpecialCoupon.findOneAndUpdate(
          updateFilter,
          {
            $inc: { usageCount: 1 },
            $push: { usedBy: { user: req.user._id, usedAt: new Date() } },
          },
          { session: mongoSession }
        );
      }
    }

    // 5. Atomic loyalty redemption (pricing engine already validated against
    //    current config; the atomic decrement guards against race conditions
    //    where the user spent points elsewhere between pricing calc and now.)
    if (pricing.loyaltyPointsRedeemed > 0) {
      const userUpdated = await User.findOneAndUpdate(
        {
          _id: req.user._id,
          loyaltyPoints: { $gte: pricing.loyaltyPointsRedeemed },
        },
        { $inc: { loyaltyPoints: -pricing.loyaltyPointsRedeemed } },
        { session: mongoSession, new: true }
      );

      if (!userUpdated) {
        throw ApiError.conflict(
          "Insufficient loyalty points balance. Please refresh your cart."
        );
      }

      await LoyaltyTransaction.create(
        [
          {
            user: req.user._id,
            type: "redeemed",
            points: -pricing.loyaltyPointsRedeemed,
            order: order._id,
            description: `Redeemed ${pricing.loyaltyPointsRedeemed} points on order ${orderId}`,
          },
        ],
        { session: mongoSession }
      );
    }

    // 6. Clear cart
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $set: { items: [], giftWrap: false, giftMessage: "" } },
      { session: mongoSession }
    );

    await mongoSession.commitTransaction();
  } catch (err) {
    await mongoSession.abortTransaction();
    throw err;
  } finally {
    mongoSession.endSession();
  }

  // Opportunistically complete a thin (OTP-created) profile from shipping info.
  await backfillUserProfile(req.user._id, shippingInfo);

  // COD confirmation gate: when enabled, hold the order (no loyalty/referral/
  // Shiprocket) and ask the customer to approve via WhatsApp. Those post-actions
  // run on confirmation (order.service.confirmCodOrder). If the WhatsApp send
  // fails, fall back to processing immediately so the order is never stuck.
  if (env.WHATSAPP_COD_HOLD) {
    order.codConfirmation = { status: "awaiting", sentAt: new Date() };
    await order.save();
    try {
      const resp = await whatsappService.sendOrderConfirmation(order);
      if (resp?.wamid) {
        order.codConfirmation.wamid = resp.wamid;
        await order.save();
      }
      return res
        .status(201)
        .json(ApiResponse.created({ order }, "Order placed — awaiting WhatsApp confirmation"));
    } catch (err) {
      console.error(`[COD] confirmation send failed for ${orderId}:`, err.message);
      order.codConfirmation.status = "confirmed";
      order.codConfirmation.error = err.message;
      await order.save();
      // fall through to normal post-actions below
    }
  }

  // Non-critical post-transaction: loyalty + referral + Shiprocket.
  await runCodPostActions(order);

  res.status(201).json(ApiResponse.created({ order }, "Order placed successfully"));
});

// GET /api/orders/my-orders
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate({
      path: "items.product",
      select: "name slug images",
    });

  res.json(ApiResponse.ok({ orders }));
});

// POST /api/orders/:orderId/return
const requestReturn = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const { orderId } = req.params;

  const order = await findUserOrder(orderId, req.user._id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  if (order.status !== "delivered") {
    throw ApiError.badRequest("Returns can only be requested for delivered orders");
  }

  if (order.returnRequest.requested) {
    throw ApiError.badRequest("A return request has already been submitted for this order");
  }

  order.returnRequest = {
    requested: true,
    reason,
    status: "requested",
    requestedAt: new Date(),
  };
  order.status = "return_requested";
  logActivity(order, {
    actor: ACTORS.CUSTOMER,
    event: "return:requested",
    note: `Customer requested a return${reason ? `: ${reason}` : ""}`,
    by: req.user._id,
  });

  await order.save();

  res.json(ApiResponse.ok({ order }, "Return request submitted successfully"));
});

// POST /api/orders/:orderId/reorder
const reorder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await findUserOrder(orderId, req.user._id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  let cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  // Add all items from the order to the cart
  for (const item of order.items) {
    const existingIndex = cart.items.findIndex(
      (cartItem) =>
        cartItem.product.toString() === item.product.toString() &&
        cartItem.selectedSize === item.selectedSize
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += item.quantity;
    } else {
      cart.items.push({
        product: item.product,
        quantity: item.quantity,
        selectedSize: item.selectedSize,
      });
    }
  }

  await cart.save();
  await cart.populate(POPULATE_PRODUCT);

  res.json(ApiResponse.ok({ cart }, "Items added to cart"));
});

// POST /api/orders/:orderId/cancel
const cancelOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await findUserOrder(orderId, req.user._id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  const cancellableStatuses = ["pending", "confirmed", "processing"];
  if (!cancellableStatuses.includes(order.status)) {
    throw ApiError.badRequest(
      `Cannot cancel order in "${order.status}" status. Contact support for help.`
    );
  }

  order.status = "cancelled";
  logActivity(order, {
    actor: ACTORS.CUSTOMER,
    event: "status:cancelled",
    note: "Customer cancelled the order",
    by: req.user._id,
  });

  // Cancel the Shiprocket shipment/order too (best-effort) so it doesn't linger.
  try {
    if (order.shipping?.awbNumber) {
      await cancelShiprocketShipment([order.shipping.awbNumber]);
    } else if (order.shipping?.shiprocketOrderId) {
      await cancelShiprocketOrder([order.shipping.shiprocketOrderId]);
    }
    if (order.shipping?.shiprocketOrderId) {
      logActivity(order, {
        actor: ACTORS.SYSTEM,
        event: "shiprocket:cancelled",
        note: "Cancelled the Shiprocket shipment",
      });
    }
  } catch (err) {
    logActivity(order, {
      actor: ACTORS.SYSTEM,
      event: "shiprocket:cancel_failed",
      note: `Could not cancel Shiprocket shipment: ${err.message}`,
    });
  }

  // Handle Razorpay refund if payment was captured
  if (
    order.payment.method === "razorpay" &&
    order.payment.status === "paid" &&
    order.payment.razorpayPaymentId
  ) {
    const refund = await razorpayService.issueRefund(
      order.payment.razorpayPaymentId
    );
    order.payment.refunds.push({
      refundId: refund.id,
      amount: Math.round(order.pricing.total * 100),
      reason: "User-initiated cancellation",
      status: "initiated",
      initiatedBy: req.user._id,
    });
    order.payment.status = "refund_initiated";

    // Save immediately after refund so the record is persisted even if
    // subsequent reversal operations fail.
    await order.save();
  }

  // Reversals are best-effort: if any fails, the order is already saved
  // with the correct status. Failed reversals can be retried manually.
  try {
    // Restore stock for all non-gift items
    for (const item of order.items) {
      if (item.isFreeGift) continue;
      if (!item.selectedSize) continue;

      await Product.findOneAndUpdate(
        { _id: item.product, "sizes.label": item.selectedSize },
        { $inc: { "sizes.$.stock": item.quantity } }
      );
      await Product.updateOne(
        { _id: item.product },
        [{ $set: { totalStock: { $sum: "$sizes.stock" } } }]
      );
    }

    // Reverse coupon usage (decrement by 1, remove ONE matching usedBy entry)
    if (order.pricing.couponCode) {
      const coupon = await Coupon.findOne({ code: order.pricing.couponCode });
      if (coupon) {
        const entryIndex = coupon.usedBy.findIndex(
          (e) => e.user.toString() === req.user._id.toString()
        );
        if (entryIndex !== -1) {
          coupon.usedBy.splice(entryIndex, 1);
          coupon.usageCount = Math.max(0, coupon.usageCount - 1);
          await coupon.save();
        }
      }
    }

    // Reverse special coupon usage
    if (order.pricing.specialCouponDiscounts?.length > 0) {
      for (const sp of order.pricing.specialCouponDiscounts) {
        const promo = await SpecialCoupon.findById(sp.specialCouponId);
        if (promo) {
          const entryIndex = promo.usedBy.findIndex(
            (e) => e.user.toString() === req.user._id.toString()
          );
          if (entryIndex !== -1) {
            promo.usedBy.splice(entryIndex, 1);
            promo.usageCount = Math.max(0, promo.usageCount - 1);
            await promo.save();
          }
        }
      }
    }

    // Reverse earned loyalty points (subtract what we awarded)
    if (order.loyaltyPointsEarned > 0) {
      await reversePoints(
        req.user._id,
        order.loyaltyPointsEarned,
        order._id,
        `Reversed ${order.loyaltyPointsEarned} points from cancelled order ${order.orderId}`
      );
    }

    // Restore redeemed loyalty points (refund them back to user)
    const redeemed = order.pricing?.loyaltyPointsRedeemed || 0;
    if (redeemed > 0) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { loyaltyPoints: redeemed },
      });
      await LoyaltyTransaction.create({
        user: req.user._id,
        type: "manual_adjustment",
        points: redeemed,
        order: order._id,
        description: `Refunded ${redeemed} redeemed points from cancelled order ${order.orderId}`,
      });
    }

    // Reverse referral reward if this was the qualifying order
    await reverseReferralReward(order._id);
  } catch (reversalErr) {
    // Log but don't fail the cancellation. The order is already cancelled
    // and refund is recorded. Reversals can be handled manually.
    console.error(`Reversal error for order ${order.orderId}:`, reversalErr.message);
  }

  // Final save (captures COD cancellation status, or any reversal state changes)
  await order.save();

  res.json(ApiResponse.ok({ order }, "Order cancelled successfully"));
});

module.exports = { placeOrder, getMyOrders, requestReturn, reorder, cancelOrder };
