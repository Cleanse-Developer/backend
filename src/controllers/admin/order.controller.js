const Order = require("../../models/Order");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");
const { processOrderRefund } = require("../../services/refund.service");
const { getConfig: getShiprocketConfig } = require("../../utils/shiprocketConfig");
const {
  shipForward,
  createShipment,
  assignAWB,
  requestPickup,
  generateLabel,
  generateManifest,
  cancelOrder,
  cancelShipment,
  createReturnOrder,
} = require("../../services/shiprocket.service");

// Forward chain: pending → confirmed → processing → packed → pickup_scheduled
// (admin "Book courier pickup") → shipped (= picked up, webhook) → in_transit →
// out_for_delivery → delivered. After booking, courier events drive the rest via
// the webhook; the manual edges past pickup_scheduled exist only as overrides.
const VALID_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["pickup_scheduled", "cancelled"],
  pickup_scheduled: ["shipped", "in_transit", "rto_in_transit", "cancelled"],
  shipped: ["in_transit", "rto_in_transit"],
  in_transit: ["out_for_delivery", "rto_in_transit"],
  out_for_delivery: ["delivered", "rto_in_transit"],
  delivered: ["return_requested"],
  rto_in_transit: ["rto_delivered"],
  rto_delivered: ["refund_initiated"],
  return_requested: ["return_approved", "delivered"],
  return_approved: ["returned"],
  returned: ["refund_initiated"],
  refund_initiated: ["refunded"],
  cancelled: ["refund_initiated"],
};

// Admin-authored log line (default actor = admin). For system/courier-attributed
// lines pass opts.actor. Keeps the legacy (order, text, by) call shape working.
const note = (order, text, by, at = new Date(), opts = {}) => {
  order.adminNotes.push({
    note: text,
    actor: opts.actor || "admin",
    event: opts.event,
    isOverride: opts.isOverride || false,
    addedBy: by,
    addedAt: at,
  });
};

/**
 * Book the courier pickup for an order: assign AWB → request pickup →
 * label/manifest. The adhoc Shiprocket order already exists (created at
 * checkout), so this resumes from its `shipmentId`; if missing, the one-call
 * `shipForward` wrapper creates + books in one shot. Best-effort: persists
 * whatever succeeded, records failures as notes, never throws. Idempotent:
 * skips if an AWB already exists. After this the courier collects on its own
 * schedule and the webhook advances the order (→ "picked up" = shipped).
 */
const bookCourierPickup = async (order, byUser, at) => {
  order.shipping = order.shipping || {};

  // Idempotency: pickup already booked (AWB assigned).
  if (order.shipping.awbNumber) return;

  const cfg = await getShiprocketConfig();
  const defaultCourierId = cfg.defaultCourierId || undefined;

  // Try the atomic wrapper first, unless we already have a shipment id.
  if (!order.shipping.shipmentId) {
    try {
      const r = await shipForward(order, defaultCourierId);
      const payload = r?.payload || r;
      if (payload?.shipment_id) {
        order.shipping.shiprocketOrderId = String(payload.order_id ?? "");
        order.shipping.shipmentId = String(payload.shipment_id);
        if (payload.awb_code) order.shipping.awbNumber = payload.awb_code;
        if (payload.courier_name) order.shipping.courierName = payload.courier_name;
        if (payload.label_url) order.shipping.labelUrl = payload.label_url;
        if (payload.manifest_url) order.shipping.manifestUrl = payload.manifest_url;
        if (payload.pickup_scheduled_date) {
          const d = new Date(payload.pickup_scheduled_date);
          if (!isNaN(d)) order.shipping.pickupScheduledDate = d;
        }
        if (order.shipping.awbNumber) {
          order.shipping.trackingUrl = `https://shiprocket.co/tracking/${order.shipping.awbNumber}`;
          note(order, `Courier pickup booked. Tracking ${order.shipping.awbNumber} (${order.shipping.courierName || "courier"})`, byUser, at, { actor: "system" });
          return;
        }
      }
    } catch (err) {
      note(order, `Shiprocket forward-shipment failed, falling back: ${err.message}`, byUser, at, { actor: "system" });
    }
  }

  // Fallback / resume: create -> assign AWB -> pickup -> label/manifest.
  try {
    if (!order.shipping.shipmentId) {
      const created = await createShipment(order);
      order.shipping.shiprocketOrderId = String(created.order_id ?? "");
      order.shipping.shipmentId = String(created.shipment_id ?? "");
    }
    if (!order.shipping.shipmentId) {
      note(order, "Shiprocket create returned no shipment_id", byUser, at, { actor: "system" });
      return;
    }

    const awbRes = await assignAWB(order.shipping.shipmentId, defaultCourierId);
    const awbData = awbRes?.response?.data || awbRes;
    order.shipping.awbNumber = awbData.awb_code || awbData.awb;
    order.shipping.courierName = awbData.courier_name;
    if (order.shipping.awbNumber) {
      order.shipping.trackingUrl = `https://shiprocket.co/tracking/${order.shipping.awbNumber}`;
    }

    await requestPickup([order.shipping.shipmentId]).catch((e) =>
      note(order, `Pickup request failed: ${e.message}`, byUser, at, { actor: "system" })
    );
    await generateLabel([order.shipping.shipmentId])
      .then((l) => {
        if (l?.label_url) order.shipping.labelUrl = l.label_url;
      })
      .catch((e) => note(order, `Label generation failed: ${e.message}`, byUser, at, { actor: "system" }));
    await generateManifest([order.shipping.shipmentId])
      .then((m) => {
        if (m?.manifest_url) order.shipping.manifestUrl = m.manifest_url;
      })
      .catch((e) => note(order, `Manifest generation failed: ${e.message}`, byUser, at, { actor: "system" }));

    note(order, `Courier pickup booked (fallback). Tracking ${order.shipping.awbNumber || "pending"}`, byUser, at, { actor: "system" });
  } catch (err) {
    note(order, `Courier pickup booking failed: ${err.message}`, byUser, at, { actor: "system" });
  }
};

/**
 * Cancel an order/shipment at Shiprocket. Uses the AWB cancel endpoint when an
 * AWB exists, otherwise the order cancel endpoint. Best-effort.
 */
const cancelAtShiprocket = async (order, byUser, at) => {
  try {
    if (order.shipping?.awbNumber) {
      await cancelShipment([order.shipping.awbNumber]);
      note(order, `Shiprocket shipment cancelled (AWB ${order.shipping.awbNumber})`, byUser, at, { actor: "system" });
    } else if (order.shipping?.shiprocketOrderId) {
      await cancelOrder([order.shipping.shiprocketOrderId]);
      note(order, `Shiprocket order cancelled (${order.shipping.shiprocketOrderId})`, byUser, at, { actor: "system" });
    }
  } catch (err) {
    note(order, `Shiprocket cancellation failed: ${err.message}`, byUser, at, { actor: "system" });
  }
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

  // Set timestamps based on status. Note: shippedAt (= picked up) is set by the
  // webhook when the courier collects, not here.
  const now = new Date();
  if (status === "confirmed") order.confirmedAt = now;
  if (status === "pickup_scheduled") order.pickupBookedAt = now;
  if (status === "delivered") order.deliveredAt = now;
  if (status === "cancelled") order.cancelledAt = now;

  // Push admin note for status change
  const noteText = note
    ? `Status changed to "${status}": ${note}`
    : `Status changed to "${status}"`;
  order.adminNotes.push({
    note: noteText,
    actor: "admin",
    event: `status:${status}`,
    addedBy: req.user._id,
    addedAt: now,
  });

  // Booking the pickup is what tells Shiprocket to send a courier (assigns AWB +
  // schedules pickup + label). Best-effort: never fail the status update if
  // Shiprocket errors. After this the courier collects and the webhook advances
  // the order to "picked up" automatically.
  if (status === "pickup_scheduled") {
    await bookCourierPickup(order, req.user._id, now);
  }

  // If cancelled and a shipment exists, cancel it at Shiprocket too.
  if (status === "cancelled") {
    await cancelAtShiprocket(order, req.user._id, now);
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

  // Issue refund + record + (for full refunds) restock and reverse rewards.
  const { refund } = await processOrderRefund(order, {
    amount,
    reason,
    initiatedBy: req.user._id,
  });

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
    actor: "admin",
    event: `return:${action}`,
    addedBy: req.user._id,
    addedAt: new Date(),
  });

  // On approval, create a Shiprocket reverse-pickup shipment (best-effort).
  if (action === "approve") {
    order.shipping = order.shipping || {};
    if (!order.shipping.returnShipment?.shipmentId) {
      try {
        const ret = await createReturnOrder(order);
        const rPayload = ret?.payload || ret;
        order.shipping.returnShipment = {
          shiprocketOrderId: String(rPayload.order_id ?? ""),
          shipmentId: String(rPayload.shipment_id ?? ""),
        };
        if (rPayload.shipment_id) {
          const awbRes = await assignAWB(String(rPayload.shipment_id));
          const awbData = awbRes?.response?.data || awbRes;
          order.shipping.returnShipment.awbNumber = awbData.awb_code || awbData.awb;
          order.shipping.returnShipment.courierName = awbData.courier_name;
          if (order.shipping.returnShipment.awbNumber) {
            order.shipping.returnShipment.trackingUrl = `https://shiprocket.co/tracking/${order.shipping.returnShipment.awbNumber}`;
          }
        }
        order.adminNotes.push({
          note: `Return pickup created. Tracking ${order.shipping.returnShipment.awbNumber || "pending"}`,
          actor: "system",
          event: "return:pickup_created",
          addedBy: req.user._id,
          addedAt: new Date(),
        });
      } catch (err) {
        order.adminNotes.push({
          note: `Return pickup could not be created: ${err.message}`,
          actor: "system",
          event: "return:pickup_failed",
          addedBy: req.user._id,
          addedAt: new Date(),
        });
      }
    }
  }

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
