const ShippingZone = require("../../models/ShippingZone");
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

module.exports = { listZones, createZone, updateZone, deleteZone };
