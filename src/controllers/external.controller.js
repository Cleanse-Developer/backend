const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const Product = require("../models/Product");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { logActivity, ACTORS } = require("../utils/orderActivity");
const { reversePoints } = require("../services/loyalty.service");
const { reverseReferralReward } = require("../services/referral.service");
const {
  cancelOrder: cancelShiprocketOrder,
  cancelShipment: cancelShiprocketShipment,
} = require("../services/shiprocket.service");
const razorpayService = require("../services/razorpay.service");
const { confirmCodOrder, isAwaitingCod } = require("../services/order.service");
const { extractLocalNumber } = require("../utils/phoneUtils");

// Build a one-line address from a shippingAddress sub-document.
const formatAddress = (addr) => {
  if (!addr) return "";
  return [
    addr.address1,
    addr.address2,
    addr.city,
    addr.state,
    addr.pincode,
    addr.country,
  ]
    .filter(Boolean)
    .join(", ");
};

// BFF summary for the external service: one object per order.
// productName/productImage come from the first non-gift item; itemCount tells
// the partner how many items the order holds (so "<first> + N more" can be shown).
const toOrderSummary = (order) => {
  const items = order.items || [];
  const first = items.find((i) => !i.isFreeGift) || items[0];
  return {
    orderId: order.orderId,
    productName: first ? first.name : "",
    productImage: first ? first.image || "" : "",
    itemCount: items.length,
    amount: order.pricing?.total ?? 0,
    address: formatAddress(order.shippingAddress),
  };
};

// GET /api/external/orders?phone=<number>
// Returns all orders for a phone number as an array of order summaries.
const getOrdersByPhone = asyncHandler(async (req, res) => {
  const raw = req.query.phone || req.params.phone;
  if (!raw) {
    throw ApiError.badRequest("phone is required");
  }

  const phone = extractLocalNumber(raw);
  if (!phone) {
    throw ApiError.badRequest("Invalid phone number");
  }

  // Phones are stored as bare 10-digit local numbers (see phoneUtils). Match on
  // both the shipping address phone and the contact phone to catch either source.
  const orders = await Order.find({
    $or: [{ "shippingAddress.phone": phone }, { contactPhone: phone }],
  }).sort({ createdAt: -1 });

  res.json(ApiResponse.ok(orders.map(toOrderSummary)));
});

// POST /api/external/orders/cancel  body: { orderId }
// Cancels an order by its human-readable orderId. Mirrors the customer cancel
// flow (status guard, Shiprocket cancel, refund, stock + reward reversals) but
// is attributed to the external system rather than a logged-in user.
const cancelOrderByOrderId = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    throw ApiError.badRequest("orderId is required");
  }

  const order = await Order.findOne({ orderId });
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
    actor: ACTORS.SYSTEM,
    event: "status:cancelled",
    note: "Order cancelled via external integration",
  });

  // Cancel the Shiprocket shipment/order too (best-effort).
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

  // Razorpay refund if payment was captured.
  if (
    order.payment.method === "razorpay" &&
    order.payment.status === "paid" &&
    order.payment.razorpayPaymentId
  ) {
    const refund = await razorpayService.issueRefund(order.payment.razorpayPaymentId);
    order.payment.refunds.push({
      refundId: refund.id,
      amount: Math.round(order.pricing.total * 100),
      reason: "External-initiated cancellation",
      status: "initiated",
      initiatedBy: order.user,
    });
    order.payment.status = "refund_initiated";
    await order.save();
  }

  // Best-effort reversals — order is already cancelled; failures can be retried.
  try {
    // Restore stock for all non-gift items.
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

    // Reverse regular coupon usage.
    if (order.pricing.couponCode && order.user) {
      const coupon = await Coupon.findOne({ code: order.pricing.couponCode });
      if (coupon) {
        const entryIndex = coupon.usedBy.findIndex(
          (e) => e.user.toString() === order.user.toString()
        );
        if (entryIndex !== -1) {
          coupon.usedBy.splice(entryIndex, 1);
          coupon.usageCount = Math.max(0, coupon.usageCount - 1);
          await coupon.save();
        }
      }
    }

    // Reverse special coupon usage.
    if (order.pricing.specialCouponDiscounts?.length > 0 && order.user) {
      for (const sp of order.pricing.specialCouponDiscounts) {
        const promo = await SpecialCoupon.findById(sp.specialCouponId);
        if (promo) {
          const entryIndex = promo.usedBy.findIndex(
            (e) => e.user.toString() === order.user.toString()
          );
          if (entryIndex !== -1) {
            promo.usedBy.splice(entryIndex, 1);
            promo.usageCount = Math.max(0, promo.usageCount - 1);
            await promo.save();
          }
        }
      }
    }

    // Reverse earned loyalty points.
    if (order.loyaltyPointsEarned > 0 && order.user) {
      await reversePoints(
        order.user,
        order.loyaltyPointsEarned,
        order._id,
        `Reversed ${order.loyaltyPointsEarned} points from cancelled order ${order.orderId}`
      );
    }

    // Restore redeemed loyalty points.
    const redeemed = order.pricing?.loyaltyPointsRedeemed || 0;
    if (redeemed > 0 && order.user) {
      await User.findByIdAndUpdate(order.user, {
        $inc: { loyaltyPoints: redeemed },
      });
      await LoyaltyTransaction.create({
        user: order.user,
        type: "manual_adjustment",
        points: redeemed,
        order: order._id,
        description: `Refunded ${redeemed} redeemed points from cancelled order ${order.orderId}`,
      });
    }

    // Reverse referral reward if this was the qualifying order.
    await reverseReferralReward(order._id);
  } catch (reversalErr) {
    console.error(`Reversal error for order ${order.orderId}:`, reversalErr.message);
  }

  await order.save();

  res.json(ApiResponse.ok({ orderId: order.orderId, status: order.status }, "Order cancelled successfully"));
});

// POST /api/external/orders/confirm  body: { orderId? }
// Confirm a COD order awaiting approval (pending → confirmed; runs the held
// loyalty/referral/Shiprocket post-actions). With an orderId, confirms that one.
// With an empty body, confirms ALL orders currently awaiting confirmation.
const confirmOrders = asyncHandler(async (req, res) => {
  const { orderId } = req.body || {};

  if (orderId) {
    const order = await Order.findOne({ orderId });
    if (!order) {
      throw ApiError.notFound("Order not found");
    }
    if (!isAwaitingCod(order)) {
      throw ApiError.badRequest(
        `Order is not awaiting confirmation (status "${order.status}").`
      );
    }
    await confirmCodOrder(order);
    return res.json(
      ApiResponse.ok({ orderId: order.orderId, status: order.status }, "Order confirmed")
    );
  }

  // No orderId — confirm every order still awaiting COD confirmation.
  const awaiting = await Order.find({
    "payment.method": "cod",
    "codConfirmation.status": "awaiting",
  });

  const orders = [];
  for (const order of awaiting) {
    await confirmCodOrder(order);
    orders.push({ orderId: order.orderId, status: order.status });
  }

  res.json(
    ApiResponse.ok({ confirmed: orders.length, orders }, `Confirmed ${orders.length} order(s)`)
  );
});

module.exports = { getOrdersByPhone, cancelOrderByOrderId, confirmOrders };
