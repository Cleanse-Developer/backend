const Order = require("../../models/Order");
const Product = require("../../models/Product");
const Coupon = require("../../models/Coupon");
const SpecialCoupon = require("../../models/SpecialCoupon");
const User = require("../../models/User");
const LoyaltyTransaction = require("../../models/LoyaltyTransaction");
const { reversePoints } = require("../../services/loyalty.service");
const { reverseReferralReward } = require("../../services/referral.service");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");
const { issueRefund } = require("../../services/razorpay.service");
const { createShipment } = require("../../services/shiprocket.service");

const VALID_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["in_transit"],
  in_transit: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: ["return_requested"],
  return_requested: ["return_approved", "delivered"],
  return_approved: ["returned"],
  returned: ["refund_initiated"],
  refund_initiated: ["refunded"],
  cancelled: ["refund_initiated"],
};

// GET /api/admin/orders
const listOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    paymentStatus,
    search,
    dateFrom,
    dateTo,
    sort = "-createdAt",
  } = req.query;

  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (paymentStatus) {
    filter["payment.status"] = paymentStatus;
  }

  if (search) {
    filter.$or = [
      { orderId: { $regex: search, $options: "i" } },
      { "shippingAddress.fullName": { $regex: search, $options: "i" } },
    ];
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const sortObj = {};
  const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
  const sortDir = sort.startsWith("-") ? -1 : 1;
  sortObj[sortField] = sortDir;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .populate("user", "fullName email phone")
      .lean(),
    Order.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      orders,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/orders/:id
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate("user", "fullName email phone loyaltyPoints")
    .populate("items.product")
    .populate("adminNotes.addedBy", "fullName")
    .lean();

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  res.json(ApiResponse.ok({ order }));
});

// PATCH /api/admin/orders/:id/status
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  if (!status) {
    throw ApiError.badRequest("Status is required");
  }

  const order = await Order.findById(req.params.id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  // Validate status transition
  const allowed = VALID_TRANSITIONS[order.status];
  if (!allowed || !allowed.includes(status)) {
    throw ApiError.badRequest(
      `Cannot transition from "${order.status}" to "${status}"`
    );
  }

  order.status = status;

  // Set timestamps based on status
  const now = new Date();
  if (status === "confirmed") order.confirmedAt = now;
  if (status === "shipped") order.shippedAt = now;
  if (status === "delivered") order.deliveredAt = now;
  if (status === "cancelled") order.cancelledAt = now;

  // Push admin note for status change
  const noteText = note
    ? `Status changed to "${status}": ${note}`
    : `Status changed to "${status}"`;
  order.adminNotes.push({
    note: noteText,
    addedBy: req.user._id,
    addedAt: now,
  });

  // If shipped, attempt Shiprocket shipment creation
  if (status === "shipped") {
    try {
      const shipment = await createShipment(order);
      if (shipment) {
        order.shipping.shiprocketOrderId = shipment.order_id?.toString();
        order.shipping.awbNumber = shipment.awb_code;
        order.shipping.courierName = shipment.courier_name;
      }
    } catch (err) {
      // Don't fail the status update if Shiprocket errors
      order.adminNotes.push({
        note: `Shiprocket shipment creation failed: ${err.message}`,
        addedBy: req.user._id,
        addedAt: now,
      });
    }
  }

  await order.save();

  res.json(ApiResponse.ok({ order }, "Order status updated"));
});

// POST /api/admin/orders/:id/refund
const processRefund = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  if (order.payment.method !== "razorpay") {
    throw ApiError.badRequest("Refunds are only supported for Razorpay payments");
  }

  const refundableStatuses = ["paid", "partially_refunded"];
  if (!refundableStatuses.includes(order.payment.status)) {
    throw ApiError.badRequest(
      `Order payment must be in 'paid' or 'partially_refunded' status to process a refund`
    );
  }

  if (!order.payment.razorpayPaymentId) {
    throw ApiError.badRequest("No Razorpay payment ID found for this order");
  }

  // Idempotency: check for duplicate initiated refund with same amount
  const refundAmountPaise = amount
    ? Math.round(amount * 100)
    : Math.round(order.pricing.total * 100);

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

  // Record refund in history
  order.payment.refunds.push({
    refundId: refund.id,
    amount: refundAmountPaise,
    reason: reason || (amount ? `Partial refund: Rs ${amount}` : "Full refund"),
    status: "initiated",
    initiatedBy: req.user._id,
  });

  // Set intermediate status (webhook will finalize to "refunded")
  order.status = "refund_initiated";
  order.payment.status = "refund_initiated";

  const isFullRefund = !amount || amount >= order.pricing.total;

  order.adminNotes.push({
    note: `Refund initiated: ${isFullRefund ? "Full refund" : `Rs ${amount}`}. Refund ID: ${refund.id}`,
    addedBy: req.user._id,
    addedAt: new Date(),
  });

  // Save immediately after refund so the record is persisted even if
  // subsequent reversal operations fail.
  await order.save();

  // For full refund: restore stock, reverse coupons, reverse loyalty.
  // These are best-effort: failures are logged but don't fail the refund.
  if (isFullRefund) {
    try {
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

      // Restore any redeemed loyalty points
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

      // Reverse referral reward if this was the qualifying order
      await reverseReferralReward(order._id);
    } catch (reversalErr) {
      console.error(`Reversal error for order ${order.orderId}:`, reversalErr.message);
    }
  }

  res.json(ApiResponse.ok({ order, refund }, "Refund initiated successfully"));
});

// PATCH /api/admin/orders/:id/return
const approveReturn = asyncHandler(async (req, res) => {
  const { action, note } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  if (order.status !== "return_requested") {
    throw ApiError.badRequest("Order is not in return_requested status");
  }

  if (action === "approve") {
    order.returnRequest.status = "approved";
    order.status = "return_approved";
  } else if (action === "reject") {
    order.returnRequest.status = "rejected";
    order.status = "delivered";
  } else {
    throw ApiError.badRequest('Action must be "approve" or "reject"');
  }

  order.adminNotes.push({
    note: `Return ${action}d${note ? `: ${note}` : ""}`,
    addedBy: req.user._id,
    addedAt: new Date(),
  });

  await order.save();

  res.json(ApiResponse.ok({ order }, `Return ${action}d successfully`));
});

// PATCH /api/admin/orders/:id/notes
const addOrderNote = asyncHandler(async (req, res) => {
  const { note } = req.body;

  if (!note || !note.trim()) {
    throw ApiError.badRequest("Note is required");
  }

  const order = await Order.findById(req.params.id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  order.adminNotes.push({
    note: note.trim(),
    addedBy: req.user._id,
    addedAt: new Date(),
  });

  await order.save();

  res.json(ApiResponse.ok({ order }, "Note added"));
});

module.exports = {
  listOrders,
  getOrder,
  updateOrderStatus,
  processRefund,
  approveReturn,
  addOrderNote,
};
