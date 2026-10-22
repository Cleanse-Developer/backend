const ShippingZone = require("../../models/ShippingZone");
const shippingChargeMode = require("../../utils/shippingChargeMode");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");

// GET /api/admin/shipping
const listZones = asyncHandler(async (req, res) => {
  const zones = await ShippingZone.find().sort({ createdAt: -1 }).lean();

  res.json(ApiResponse.ok(zones));
});

// POST /api/admin/shipping
const createZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.create(req.body);

  res.status(201).json(ApiResponse.created(zone, "Shipping zone created"));
});

// PATCH /api/admin/shipping/:id
const updateZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.findById(req.params.id);
  if (!zone) {
    throw ApiError.notFound("Shipping zone not found");
  }

  Object.assign(zone, req.body);
  await zone.save();

  res.json(ApiResponse.ok(zone, "Shipping zone updated"));
});

// DELETE /api/admin/shipping/:id
const deleteZone = asyncHandler(async (req, res) => {
  const zone = await ShippingZone.findById(req.params.id);
  if (!zone) {
    throw ApiError.notFound("Shipping zone not found");
  }

  await ShippingZone.findByIdAndDelete(req.params.id);

  res.json(ApiResponse.ok(null, "Shipping zone deleted"));
});

// GET /api/admin/shipping/charge-mode
// "static" = the admin rates on this page; "dynamic" = live Shiprocket rates, with
// the static rates as the fallback.
const getChargeMode = asyncHandler(async (req, res) => {
  const config = await shippingChargeMode.getConfig();
  res.json(ApiResponse.ok({ config }, "Delivery charge mode"));
});

// PATCH /api/admin/shipping/charge-mode
// Body: { mode, courierRule, freeThreshold: { mode, amount }, adjustment, cap }
const setChargeMode = asyncHandler(async (req, res) => {
  const config = await shippingChargeMode.setConfig(req.body);
  res.json(ApiResponse.ok({ config }, `Delivery charges set to ${config.mode}`));
});

module.exports = { listZones, createZone, updateZone, deleteZone, getChargeMode, setChargeMode };
