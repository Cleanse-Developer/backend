const Product = require("../models/Product");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const ApiError = require("../utils/ApiError");
const { issueRefund } = require("./razorpay.service");
const { reversePoints } = require("./loyalty.service");
const { reverseReferralReward } = require("./referral.service");

/**
 * Restore stock for every non-gift line item of an order and recompute each
 * product's totalStock. Best-effort: callers may wrap in try/catch.
 */
const restockOrder = async (order) => {
  for (const item of order.items) {
    if (item.isFreeGift || !item.selectedSize) continue;
    await Product.findOneAndUpdate(
      { _id: item.product, "sizes.label": item.selectedSize },
      { $inc: { "sizes.$.stock": item.quantity } }
    );
    await Product.updateOne({ _id: item.product }, [
      { $set: { totalStock: { $sum: "$sizes.stock" } } },
    ]);
  }
};

/**
 * Reverse coupon usage, loyalty points (earned + redeemed) and referral reward
 * tied to an order. Best-effort — errors are logged, not thrown.
 */
const reverseOrderRewards = async (order) => {
  try {
    if (order.pricing.couponCode) {
      const coupon = await Coupon.findOne({ code: order.pricing.couponCode });
      if (coupon) {
        const idx = coupon.usedBy.findIndex(
          (e) => e.user.toString() === order.user.toString()
        );
        if (idx !== -1) {
          coupon.usedBy.splice(idx, 1);
          coupon.usageCount = Math.max(0, coupon.usageCount - 1);
          await coupon.save();
        }
      }
    }

    if (order.pricing.specialCouponDiscounts?.length > 0) {
      for (const sp of order.pricing.specialCouponDiscounts) {
        const promo = await SpecialCoupon.findById(sp.specialCouponId);
        if (promo) {
          const idx = promo.usedBy.findIndex(
            (e) => e.user.toString() === order.user.toString()
          );
          if (idx !== -1) {
            promo.usedBy.splice(idx, 1);
            promo.usageCount = Math.max(0, promo.usageCount - 1);
            await promo.save();
          }
        }
      }
    }

    if (order.loyaltyPointsEarned > 0) {
      await reversePoints(
        order.user,
        order.loyaltyPointsEarned,
        order._id,
        `Reversed ${order.loyaltyPointsEarned} points from refunded order ${order.orderId}`
      );
    }

    const redeemed = order.pricing?.loyaltyPointsRedeemed || 0;
    if (redeemed > 0) {
      await User.findByIdAndUpdate(order.user, {
        $inc: { loyaltyPoints: redeemed },
      });
      await LoyaltyTransaction.create({
        user: order.user,
        type: "manual_adjustment",
        points: redeemed,
        order: order._id,
        description: `Refunded ${redeemed} redeemed points from refunded order ${order.orderId}`,
      });
    }

    await reverseReferralReward(order._id);
  } catch (reversalErr) {
    console.error(`Reversal error for order ${order.orderId}:`, reversalErr.message);
  }
};

/**
 * Issue a Razorpay refund for an order and record it. Shared by the admin
 * refund endpoint and the webhook auto-refund path (RTO / return delivered).
 *
 * Saves the order after recording the refund, then (for a full refund) restocks
 * and reverses rewards best-effort. `initiatedBy` is the admin user id, or null
 * for system/webhook-initiated refunds.
 *
 * @returns {Promise<{refund: object, isFullRefund: boolean}>}
 */
const processOrderRefund = async (order, { amount, reason, initiatedBy = null } = {}) => {
  if (order.payment.method !== "razorpay") {
    throw ApiError.badRequest("Refunds are only supported for Razorpay payments");
  }

  const refundableStatuses = ["paid", "partially_refunded"];
  if (!refundableStatuses.includes(order.payment.status)) {
    throw ApiError.badRequest(
      "Order payment must be in 'paid' or 'partially_refunded' status to process a refund"
    );
  }

  if (!order.payment.razorpayPaymentId) {
    throw ApiError.badRequest("No Razorpay payment ID found for this order");
  }

  const refundAmountPaise = amount
    ? Math.round(amount * 100)
    : Math.round(order.pricing.total * 100);

  // Idempotency: don't double-issue an in-flight refund for the same amount.
  const duplicateRefund = order.payment.refunds?.find(
    (r) => r.status === "initiated" && r.amount === refundAmountPaise
  );
  if (duplicateRefund) {
    throw ApiError.conflict("A refund for this amount is already in progress");
  }

  const refund = await issueRefund(
    order.payment.razorpayPaymentId,
    amount ? refundAmountPaise : undefined
  );

  order.payment.refunds.push({
    refundId: refund.id,
    amount: refundAmountPaise,
    reason: reason || (amount ? `Partial refund: Rs ${amount}` : "Full refund"),
    status: "initiated",
    initiatedBy,
  });

  order.status = "refund_initiated";
  order.payment.status = "refund_initiated";

  const isFullRefund = !amount || amount >= order.pricing.total;

  order.adminNotes.push({
    note: `Refund started: ${isFullRefund ? "Full refund" : `Rs ${amount}`} (ref ${refund.id})`,
    actor: initiatedBy ? "admin" : "system",
    event: "refund:initiated",
    addedBy: initiatedBy,
    addedAt: new Date(),
  });

  // Persist immediately so the refund record survives any later reversal failure.
  await order.save();

  if (isFullRefund) {
    try {
      await restockOrder(order);
    } catch (err) {
      console.error(`Restock error for order ${order.orderId}:`, err.message);
    }
    await reverseOrderRewards(order);
  }

  return { refund, isFullRefund };
};

module.exports = { processOrderRefund, restockOrder, reverseOrderRewards };
