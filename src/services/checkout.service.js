const mongoose = require("mongoose");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const Product = require("../models/Product");
const SpinWheelEntry = require("../models/SpinWheelEntry");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const { createOrderId } = require("./order.service");
const { awardPoints, redeemPoints } = require("./loyalty.service");
const { processReferralReward } = require("./referral.service");
const ApiError = require("../utils/ApiError");

/**
 * Create an Order from a frozen PaymentSession snapshot.
 * Called by both the /checkout/confirm endpoint and the webhook handler.
 * Must run inside a MongoDB transaction.
 *
 * @param {object} session - PaymentSession document (with pricing, cart, addresses frozen)
 * @param {object} paymentDetails - { method, razorpayOrderId?, razorpayPaymentId? }
 * @param {import("mongoose").ClientSession} mongoSession - Active transaction session
 * @returns {Promise<object>} Created Order document
 */
const createOrderFromSession = async (session, paymentDetails, mongoSession) => {
  const orderId = await createOrderId();

  // Build order items from frozen snapshot (no DB queries needed)
  const orderItems = session.cart.items.map((item) => ({
    product: item.product,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    selectedSize: item.selectedSize || undefined,
    image: item.image || "",
    isFreeGift: item.isFreeGift || false,
  }));

  // Add free gift items from frozen pricing
  if (session.pricing.freeGifts && session.pricing.freeGifts.length > 0) {
    for (const gift of session.pricing.freeGifts) {
      orderItems.push({
        product: gift.productId,
        name: gift.productName || "Gift",
        price: 0,
        quantity: gift.quantity || 1,
        selectedSize: gift.variantSize || undefined,
        image: gift.productImage || "",
        isFreeGift: true,
      });
    }
  }

  const isRazorpay = paymentDetails.method === "razorpay";

  // Create Order document
  const [order] = await Order.create(
    [
      {
        orderId,
        user: session.user,
        items: orderItems,
        shippingAddress: session.shippingAddress,
        billingAddress: session.billingSameAsShipping
          ? session.shippingAddress
          : session.billingAddress,
        billingSameAsShipping: session.billingSameAsShipping,
        paymentSession: session._id,
        payment: {
          method: paymentDetails.method,
          razorpayOrderId: paymentDetails.razorpayOrderId || undefined,
          razorpayPaymentId: paymentDetails.razorpayPaymentId || undefined,
          status: isRazorpay ? "paid" : "pending",
        },
        pricing: {
          subtotal: session.pricing.subtotal,
          bundleDiscounts: session.pricing.bundleDiscounts,
          bundleDiscountTotal: session.pricing.bundleDiscountTotal,
          tierDiscount: session.pricing.tierDiscount,
          tierPercent: session.pricing.tierPercent,
          tierLabel: session.pricing.tierLabel,
          specialCouponDiscounts: session.pricing.specialCouponDiscounts,
          specialCouponDiscountTotal: session.pricing.specialCouponDiscountTotal || 0,
          couponDiscount: session.pricing.couponDiscount,
          couponCode: session.pricing.couponCode,
          shippingCost: session.pricing.shippingCost,
          giftWrapCost: session.pricing.giftWrapCost,
          loyaltyDiscount: session.pricing.loyaltyDiscount || 0,
          loyaltyPointsRedeemed: session.pricing.loyaltyPointsRedeemed || 0,
          total: session.pricing.total,
        },
        giftWrap: session.giftWrap || false,
        giftMessage: session.giftMessage,
        contactEmail: session.shippingAddress.email,
        contactPhone: session.shippingAddress.phone,
        status: isRazorpay ? "confirmed" : "pending",
        loyaltyPointsEarned: session.pricing.loyaltyPoints || 0,
      },
    ],
    { session: mongoSession }
  );

  // Update regular coupon usage atomically with $lt guard
  if (session.pricing.couponCode) {
    const coupon = await Coupon.findOne({ code: session.pricing.couponCode })
      .select("usageLimit")
      .lean()
      .session(mongoSession);

    const filter = { code: session.pricing.couponCode };
    if (coupon?.usageLimit) {
      filter.usageCount = { $lt: coupon.usageLimit };
    }

    const couponResult = await Coupon.findOneAndUpdate(
      filter,
      {
        $inc: { usageCount: 1 },
        $push: { usedBy: { user: session.user, usedAt: new Date() } },
      },
      { session: mongoSession }
    );

    if (!couponResult && coupon?.usageLimit) {
      throw ApiError.conflict("Coupon usage limit reached. Please re-initiate checkout.");
    }

    // Sync spin wheel entry if applicable
    if (session.pricing.couponCode.startsWith("SPIN-")) {
      await SpinWheelEntry.findOneAndUpdate(
        { couponCode: session.pricing.couponCode },
        { isRedeemed: true, redeemedAt: new Date(), user: session.user },
        { session: mongoSession }
      );
    }
  }

  // Update special coupon usage atomically with limit check
  if (
    session.pricing.specialCouponDiscounts &&
    session.pricing.specialCouponDiscounts.length > 0
  ) {
    for (const sp of session.pricing.specialCouponDiscounts) {
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
          $push: { usedBy: { user: session.user, usedAt: new Date() } },
        },
        { session: mongoSession }
      );
    }
  }

  // Atomic loyalty redemption inside the same transaction
  const pointsToRedeem = session.pricing.loyaltyPointsRedeemed || 0;
  if (pointsToRedeem > 0) {
    // Re-validate against the CURRENT loyalty config in case it changed
    // between session creation and order finalization (admin disabled the
    // program, raised the minimum, lowered the max %, etc.)
    const { getLoyaltyConfig } = require("./loyalty.service");
    const currentConfig = await getLoyaltyConfig();

    if (!currentConfig.enabled) {
      throw ApiError.conflict(
        "Loyalty program is currently disabled. Please re-initiate checkout."
      );
    }
    if (pointsToRedeem < currentConfig.minRedemptionPoints) {
      throw ApiError.conflict(
        `Minimum redemption is now ${currentConfig.minRedemptionPoints} points. Please re-initiate checkout.`
      );
    }
    // Verify the redemption still respects the max % cap on the frozen subtotal
    const maxAllowedDiscount = Math.floor(
      (session.pricing.subtotal * currentConfig.maxPercentOfOrder) / 100
    );
    const proposedDiscount = session.pricing.loyaltyDiscount || 0;
    if (proposedDiscount > maxAllowedDiscount) {
      throw ApiError.conflict(
        "Loyalty redemption rules changed. Please re-initiate checkout."
      );
    }

    // Atomic balance guard
    const userUpdated = await User.findOneAndUpdate(
      { _id: session.user, loyaltyPoints: { $gte: pointsToRedeem } },
      { $inc: { loyaltyPoints: -pointsToRedeem } },
      { session: mongoSession, new: true }
    );

    if (!userUpdated) {
      throw ApiError.conflict(
        "Insufficient loyalty points balance. Please re-initiate checkout."
      );
    }

    await LoyaltyTransaction.create(
      [
        {
          user: session.user,
          type: "redeemed",
          points: -pointsToRedeem,
          order: order._id,
          description: `Redeemed ${pointsToRedeem} points on order ${orderId}`,
        },
      ],
      { session: mongoSession }
    );
  }

  // Mark session as completed
  session.status = "completed";
  session.completedAt = new Date();
  session.orderId = order._id;
  await session.save({ session: mongoSession });

  // Clear user cart
  await Cart.findOneAndUpdate(
    { user: session.user },
    { $set: { items: [], giftWrap: false, giftMessage: "" } },
    { session: mongoSession }
  );

  return order;
};

/**
 * Post-transaction actions (non-critical, outside the MongoDB transaction).
 *
 * @param {object} order - Created Order document
 * @param {object} session - PaymentSession document
 */
const postOrderActions = async (order, session) => {
  // Cancel the Agenda expiry job
  if (session.agendaJobId) {
    try {
      const agenda = require("../config/agenda");
      await agenda.cancel({ _id: new mongoose.Types.ObjectId(session.agendaJobId) });
    } catch (err) {
      // Non-critical: job will fire but no-op since session is completed
    }
  }

  // Award loyalty points
  await awardPoints(
    session.user,
    order.loyaltyPointsEarned,
    order._id,
    `Earned ${order.loyaltyPointsEarned} points from order ${order.orderId}`
  );

  // Process referral reward (best-effort)
  try {
    await processReferralReward(order._id, session.user);
  } catch (err) {
    console.error("Referral reward error:", err.message);
  }

  // Queue adhoc Shiprocket order creation (best-effort, non-blocking).
  const { scheduleShiprocketCreate } = require("../jobs/createShiprocketOrder");
  await scheduleShiprocketCreate(order._id);
};

/**
 * Enrich specialCouponDiscounts freeItems with product names and prices.
 * Called during checkout initiation to freeze enriched data in the session.
 *
 * @param {Array} discounts - specialCouponDiscounts array from pricing engine
 * @returns {Promise<Array>} Enriched discounts
 */
const enrichSpecialDiscounts = async (discounts) => {
  if (!discounts || discounts.length === 0) return [];

  const enriched = [];
  for (const sp of discounts) {
    const enrichedFreeItems = [];
    if (sp.freeItems && sp.freeItems.length > 0) {
      for (const fi of sp.freeItems) {
        const prod = await Product.findById(fi.productId)
          .select("name price")
          .lean();
        enrichedFreeItems.push({
          productId: fi.productId,
          productName: prod?.name || "Gift",
          quantity: fi.quantity || 1,
          unitPrice: prod?.price || 0,
        });
      }
    }
    enriched.push({
      specialCouponId: sp.specialCouponId,
      promotionType: sp.promotionType,
      title: sp.title,
      code: sp.code || null,
      discountAmount: sp.discountAmount,
      freeItems: enrichedFreeItems,
    });
  }
  return enriched;
};

module.exports = { createOrderFromSession, postOrderActions, enrichSpecialDiscounts };
