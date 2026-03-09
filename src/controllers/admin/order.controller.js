const Order = require("../../models/Order");
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
  returned: ["refunded"],
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
  const { amount } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  if (order.payment.method !== "razorpay") {
    throw ApiError.badRequest("Refunds are only supported for Razorpay payments");
  }

  if (order.payment.status !== "paid") {
    throw ApiError.badRequest("Order payment must be in 'paid' status to process a refund");
  }

  if (!order.payment.razorpayPaymentId) {
    throw ApiError.badRequest("No Razorpay payment ID found for this order");
  }

  // Amount in paise; if not provided, full refund
  const refundAmountPaise = amount
    ? Math.round(amount * 100)
    : undefined;

  const refund = await issueRefund(
    order.payment.razorpayPaymentId,
    refundAmountPaise
  );

  order.payment.status = "refunded";
  order.status = "refunded";
  order.adminNotes.push({
    note: `Refund processed: ${amount ? `Rs ${amount}` : "Full refund"}. Refund ID: ${refund.id}`,
    addedBy: req.user._id,
    addedAt: new Date(),
  });

  await order.save();

  res.json(ApiResponse.ok({ order, refund }, "Refund processed successfully"));
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
  addOrderNote,
};
