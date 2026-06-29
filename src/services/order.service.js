const Order = require("../models/Order");
const Product = require("../models/Product");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const generateOrderId = require("../utils/generateOrderId");
const { awardPoints } = require("./loyalty.service");
const { processReferralReward } = require("./referral.service");
const whatsappService = require("./whatsapp.service");

/**
 * Generate a unique order ID in the format "CA-YYYY-XXXX".
 * @returns {Promise<string>}
 */
const createOrderId = async () => {
  return generateOrderId(Order);
};

/**
 * Post-transaction side-effects for a COD order, run only AFTER the customer
 * approves (or when COD hold is disabled). Mirrors the inline block in
 * order.controller.placeOrder. Each step is best-effort.
 */
const runCodPostActions = async (order) => {
  try {
    if (order.loyaltyPointsEarned > 0) {
      await awardPoints(
        order.user,
        order.loyaltyPointsEarned,
        order._id,
        `Earned ${order.loyaltyPointsEarned} points from order ${order.orderId}`
      );
    }
  } catch (err) {
    console.error(`[COD] awardPoints failed for ${order.orderId}:`, err.message);
  }

  try {
    await processReferralReward(order._id, order.user);
  } catch (err) {
    console.error(`[COD] referral reward failed for ${order.orderId}:`, err.message);
  }

  try {
    const { scheduleShiprocketCreate } = require("../jobs/createShiprocketOrder");
    await scheduleShiprocketCreate(order._id);
  } catch (err) {
    console.error(`[COD] Shiprocket schedule failed for ${order.orderId}:`, err.message);
  }
};

const isAwaitingCod = (order) =>
  order &&
  order.payment?.method === "cod" &&
  order.codConfirmation?.status === "awaiting";

/**
 * Customer approved the COD order via WhatsApp. Idempotent: only acts on an
 * order still "awaiting". Promotes pending → confirmed, runs the held
 * post-actions (loyalty/referral/Shiprocket), then sends the order summary.
 */
const confirmCodOrder = async (order) => {
  if (!isAwaitingCod(order)) {
    console.log(`[COD] confirm ignored for ${order?.orderId} — not awaiting`, {
      status: order?.codConfirmation?.status,
    });
    return order;
  }
  console.log(`[COD] confirming ${order.orderId}`);

  order.status = "confirmed";
  order.codConfirmation.status = "confirmed";
  order.codConfirmation.respondedAt = new Date();
  await order.save();

  await runCodPostActions(order);

  try {
    await whatsappService.sendOrderSummary(order);
  } catch (err) {
    console.error(`[COD] order summary send failed for ${order.orderId}:`, err.message);
  }

  return order;
};

/**
 * Customer rejected the COD order via WhatsApp. Idempotent. Marks cancelled and
 * reverses everything that was applied at placement: stock, coupon usage,
 * special-coupon usage, and redeemed loyalty points. Earned points and referral
 * rewards were never applied for a held order, so there is nothing to reverse
 * there.
 */
const cancelCodOrder = async (order, reason = "Customer declined via WhatsApp") => {
  if (!isAwaitingCod(order)) {
    console.log(`[COD] cancel ignored for ${order?.orderId} — not awaiting`, {
      status: order?.codConfirmation?.status,
    });
    return order;
  }
  console.log(`[COD] cancelling ${order.orderId} — ${reason}`);

  order.status = "cancelled";
  order.codConfirmation.status = "cancelled";
  order.codConfirmation.respondedAt = new Date();
  order.adminNotes.push({ note: `COD cancelled: ${reason}`, addedAt: new Date() });
  await order.save();

  // Best-effort reversals (order is already cancelled if any of these fail).
  try {
    // Restock non-gift items
    for (const item of order.items) {
      if (item.isFreeGift || !item.selectedSize) continue;
      await Product.findOneAndUpdate(
        { _id: item.product, "sizes.label": item.selectedSize },
        { $inc: { "sizes.$.stock": item.quantity } }
      );
      await Product.updateOne(
        { _id: item.product },
        [{ $set: { totalStock: { $sum: "$sizes.stock" } } }]
      );
    }

    // Reverse regular coupon usage (one usedBy entry for this user)
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

    // Reverse special coupon usage
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

    // Restore redeemed loyalty points (these WERE decremented at placement)
    const redeemed = order.pricing?.loyaltyPointsRedeemed || 0;
    if (redeemed > 0) {
      await User.findByIdAndUpdate(order.user, { $inc: { loyaltyPoints: redeemed } });
      await LoyaltyTransaction.create({
        user: order.user,
        type: "manual_adjustment",
        points: redeemed,
        order: order._id,
        description: `Refunded ${redeemed} redeemed points from cancelled order ${order.orderId}`,
      });
    }
  } catch (err) {
    console.error(`[COD] cancel reversal error for ${order.orderId}:`, err.message);
  }

  return order;
};

module.exports = {
  createOrderId,
  runCodPostActions,
  confirmCodOrder,
  cancelCodOrder,
  isAwaitingCod,
};
