const Order = require("../../models/Order");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const sr = require("../../services/shiprocket.service");
const shiprocketMode = require("../../utils/shiprocketMode");

const TRACKING_URL = (awb) => `https://shiprocket.co/tracking/${awb}`;

const loadOrder = async (id) => {
  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound("Order not found");
  order.shipping = order.shipping || {};
  return order;
};

const adminNote = (order, text, by) =>
  order.adminNotes.push({ note: text, addedBy: by, addedAt: new Date() });

// ---- Per-order operations ----

// POST /api/admin/orders/:id/shiprocket/sync — create the adhoc order now.
const syncOrder = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (order.shipping.shiprocketOrderId) {
    throw ApiError.badRequest("Shiprocket order already created for this order");
  }
  const r = await sr.createShipment(order);
  order.shipping.shiprocketOrderId = String(r.order_id ?? "");
  order.shipping.shipmentId = String(r.shipment_id ?? "");
  adminNote(order, `Shiprocket order synced (id ${order.shipping.shiprocketOrderId})`, req.user._id);
  await order.save();
  res.json(ApiResponse.ok({ order, shiprocket: r }, "Shiprocket order created"));
});

// POST /api/admin/orders/:id/shiprocket/assign-awb { courierId? }
const assignAwb = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order.shipping.shipmentId) {
    throw ApiError.badRequest("No shipment_id — create the Shiprocket order first");
  }
  const r = await sr.assignAWB(order.shipping.shipmentId, req.body.courierId);
  const data = r?.response?.data || r;
  order.shipping.awbNumber = data.awb_code || data.awb;
  order.shipping.courierName = data.courier_name;
  if (order.shipping.awbNumber) {
    order.shipping.trackingUrl = TRACKING_URL(order.shipping.awbNumber);
  }
  adminNote(order, `AWB assigned: ${order.shipping.awbNumber} (${order.shipping.courierName || "?"})`, req.user._id);
  await order.save();
  res.json(ApiResponse.ok({ order, shiprocket: r }, "AWB assigned"));
});

// POST /api/admin/orders/:id/shiprocket/pickup
const schedulePickup = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order.shipping.shipmentId) {
    throw ApiError.badRequest("No shipment_id — create the Shiprocket order first");
  }
  const r = await sr.requestPickup([order.shipping.shipmentId]);
  const date = r?.response?.pickup_scheduled_date || r?.pickup_scheduled_date;
  if (date) {
    const d = new Date(date);
    if (!isNaN(d)) order.shipping.pickupScheduledDate = d;
  }
  adminNote(order, "Pickup scheduled", req.user._id);
  await order.save();
  res.json(ApiResponse.ok({ order, shiprocket: r }, "Pickup scheduled"));
});

// POST /api/admin/orders/:id/shiprocket/label
const generateLabel = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order.shipping.shipmentId) {
    throw ApiError.badRequest("No shipment_id — create the Shiprocket order first");
  }
  const r = await sr.generateLabel([order.shipping.shipmentId]);
  if (r?.label_url) order.shipping.labelUrl = r.label_url;
  await order.save();
  res.json(ApiResponse.ok({ order, url: order.shipping.labelUrl, shiprocket: r }, "Label generated"));
});

// POST /api/admin/orders/:id/shiprocket/manifest
const generateManifest = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order.shipping.shipmentId) {
    throw ApiError.badRequest("No shipment_id — create the Shiprocket order first");
  }
  const r = await sr.generateManifest([order.shipping.shipmentId]);
  if (r?.manifest_url) order.shipping.manifestUrl = r.manifest_url;
  await order.save();
  res.json(ApiResponse.ok({ order, url: order.shipping.manifestUrl, shiprocket: r }, "Manifest generated"));
});

// POST /api/admin/orders/:id/shiprocket/invoice
const generateInvoice = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order.shipping.shiprocketOrderId) {
    throw ApiError.badRequest("No Shiprocket order id — create the Shiprocket order first");
  }
  const r = await sr.generateInvoice([order.shipping.shiprocketOrderId]);
  const url = r?.invoice_url;
  res.json(ApiResponse.ok({ url, shiprocket: r }, "Invoice generated"));
});

// POST /api/admin/orders/:id/shiprocket/cancel
const cancelShipment = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  let r;
  if (order.shipping.awbNumber) {
    r = await sr.cancelShipment([order.shipping.awbNumber]);
    adminNote(order, `Shiprocket shipment cancelled (AWB ${order.shipping.awbNumber})`, req.user._id);
  } else if (order.shipping.shiprocketOrderId) {
    r = await sr.cancelOrder([order.shipping.shiprocketOrderId]);
    adminNote(order, `Shiprocket order cancelled (${order.shipping.shiprocketOrderId})`, req.user._id);
  } else {
    throw ApiError.badRequest("No Shiprocket order/shipment to cancel");
  }
  await order.save();
  res.json(ApiResponse.ok({ order, shiprocket: r }, "Cancellation requested"));
});

// GET /api/admin/orders/:id/shiprocket/track
const track = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order.shipping.awbNumber) {
    throw ApiError.badRequest("No AWB to track");
  }
  const r = await sr.trackShipment(order.shipping.awbNumber);
  res.json(ApiResponse.ok({ tracking: r }, "Tracking fetched"));
});

// POST /api/admin/orders/:id/shiprocket/ndr { action, comments }
const ndrAction = asyncHandler(async (req, res) => {
  const { action, comments } = req.body;
  if (!["re-attempt", "fake-attempt", "return"].includes(action)) {
    throw ApiError.badRequest('action must be "re-attempt", "fake-attempt", or "return"');
  }
  const order = await loadOrder(req.params.id);
  if (!order.shipping.awbNumber) {
    throw ApiError.badRequest("No AWB for NDR action");
  }
  const r = await sr.ndrAction(order.shipping.awbNumber, action, comments || "");
  adminNote(order, `NDR action "${action}"${comments ? `: ${comments}` : ""}`, req.user._id);
  await order.save();
  res.json(ApiResponse.ok({ order, shiprocket: r }, "NDR action submitted"));
});

// POST /api/admin/orders/:id/shiprocket/return — manual reverse-pickup
const createReturn = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (order.shipping.returnShipment?.shipmentId) {
    throw ApiError.badRequest("Return shipment already exists");
  }
  const ret = await sr.createReturnOrder(order);
  const p = ret?.payload || ret;
  order.shipping.returnShipment = {
    shiprocketOrderId: String(p.order_id ?? ""),
    shipmentId: String(p.shipment_id ?? ""),
  };
  if (p.shipment_id) {
    const awbRes = await sr.assignAWB(String(p.shipment_id));
    const awbData = awbRes?.response?.data || awbRes;
    order.shipping.returnShipment.awbNumber = awbData.awb_code || awbData.awb;
    order.shipping.returnShipment.courierName = awbData.courier_name;
    if (order.shipping.returnShipment.awbNumber) {
      order.shipping.returnShipment.trackingUrl = TRACKING_URL(order.shipping.returnShipment.awbNumber);
    }
  }
  adminNote(order, `Return pickup created (AWB ${order.shipping.returnShipment.awbNumber || "pending"})`, req.user._id);
  await order.save();
  res.json(ApiResponse.ok({ order, shiprocket: ret }, "Return shipment created"));
});

// GET /api/admin/orders/:id/shiprocket/serviceability
const orderServiceability = asyncHandler(async (req, res) => {
  const order = await loadOrder(req.params.id);
  const cod = order.payment.method === "cod" ? 1 : 0;
  const r = await sr.checkServiceability(order.shippingAddress.pincode, 0.5, cod);
  res.json(ApiResponse.ok({ serviceability: r }, "Serviceability fetched"));
});

// ---- Global (account-level) operations ----

// GET /api/admin/shiprocket/pickup
const listPickup = asyncHandler(async (req, res) => {
  const r = await sr.getPickupLocations();
  res.json(ApiResponse.ok({ pickup: r?.data || r }, "Pickup locations"));
});

// POST /api/admin/shiprocket/pickup
const addPickup = asyncHandler(async (req, res) => {
  const r = await sr.addPickupLocation(req.body);
  res.json(ApiResponse.ok({ result: r }, "Pickup location added"));
});

// GET /api/admin/shiprocket/couriers
const couriers = asyncHandler(async (req, res) => {
  const r = await sr.listCouriers();
  res.json(ApiResponse.ok({ couriers: r?.courier_data || r?.data || r }, "Couriers"));
});

// GET /api/admin/shiprocket/wallet
const wallet = asyncHandler(async (req, res) => {
  const r = await sr.getWalletBalance();
  res.json(ApiResponse.ok({ balance: r?.data?.balance_amount ?? null, raw: r }, "Wallet balance"));
});

// POST /api/admin/shiprocket/serviceability { pincode, cod, weight }
const serviceability = asyncHandler(async (req, res) => {
  const { pincode, cod = 1, weight = 0.5 } = req.body;
  if (!pincode || !/^\d{6}$/.test(String(pincode))) {
    throw ApiError.badRequest("Valid 6-digit pincode is required");
  }
  const r = await sr.checkServiceability(pincode, weight, cod ? 1 : 0);
  res.json(ApiResponse.ok({ serviceability: r }, "Serviceability fetched"));
});

// GET /api/admin/shiprocket/mode
const getMode = asyncHandler(async (req, res) => {
  const mode = await shiprocketMode.getMode();
  res.json(ApiResponse.ok({ mode }, "Shiprocket mode"));
});

// PATCH /api/admin/shiprocket/mode { mode: "live" | "test" }
const setMode = asyncHandler(async (req, res) => {
  const { mode } = req.body;
  if (!["live", "test"].includes(mode)) {
    throw ApiError.badRequest('mode must be "live" or "test"');
  }
  const saved = await shiprocketMode.setMode(mode);
  res.json(ApiResponse.ok({ mode: saved }, `Shiprocket mode set to ${saved}`));
});

module.exports = {
  // per-order
  syncOrder,
  assignAwb,
  schedulePickup,
  generateLabel,
  generateManifest,
  generateInvoice,
  cancelShipment,
  track,
  ndrAction,
  createReturn,
  orderServiceability,
  // global
  listPickup,
  addPickup,
  couriers,
  wallet,
  serviceability,
  getMode,
  setMode,
};
