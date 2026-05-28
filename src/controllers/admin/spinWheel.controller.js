const SpinWheelPrize = require("../../models/SpinWheelPrize");
const SpinWheelEntry = require("../../models/SpinWheelEntry");
const Settings = require("../../models/Settings");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");
const { invalidateSettingsCache } = require("../settings.controller");

// GET /api/admin/spin-wheel/prizes
const listPrizes = asyncHandler(async (req, res) => {
  const prizes = await SpinWheelPrize.find().sort({ _id: 1 }).lean();
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);

  res.json(ApiResponse.ok({ prizes, totalWeight }));
});

// POST /api/admin/spin-wheel/prizes
const createPrize = asyncHandler(async (req, res) => {
  const { label, value, weight, discountType, discountValue, color, textColor, isActive } = req.body;

  if (!label || !value || weight == null) {
    throw ApiError.badRequest("label, value, and weight are required");
  }

  const numWeight = Number(weight);
  if (isNaN(numWeight) || numWeight < 0 || numWeight > 100) {
    throw ApiError.badRequest("Weight must be between 0 and 100");
  }

  if (discountType && discountType !== "free_shipping") {
    const dv = Number(discountValue);
    if (isNaN(dv) || dv < 0) {
      throw ApiError.badRequest("Discount value must be 0 or greater");
    }
    if (discountType === "percentage" && dv > 100) {
      throw ApiError.badRequest("Percentage discount cannot exceed 100");
    }
  }

  const existing = await SpinWheelPrize.findOne({ value: value.toLowerCase() });
  if (existing) {
    throw ApiError.conflict(`Prize with value "${value}" already exists`);
  }

  const prize = await SpinWheelPrize.create({
    label: String(label).slice(0, 50),
    value: value.toLowerCase(),
    weight: numWeight,
    discountType: discountType || null,
    discountValue: discountValue ? Number(discountValue) : 0,
    color: color || "#4F2C22",
    textColor: textColor || "#F0EDE8",
    isActive: isActive !== false,
  });

  res.status(201).json(ApiResponse.created({ prize }));
});

// PATCH /api/admin/spin-wheel/prizes/:id
const updatePrize = asyncHandler(async (req, res) => {
  const prize = await SpinWheelPrize.findById(req.params.id);
  if (!prize) {
    throw ApiError.notFound("Prize not found");
  }

  // Validate before applying
  if (req.body.weight !== undefined) {
    const w = Number(req.body.weight);
    if (isNaN(w) || w < 0 || w > 100) {
      throw ApiError.badRequest("Weight must be between 0 and 100");
    }
    prize.weight = w;
  }

  const dt = req.body.discountType !== undefined ? req.body.discountType : prize.discountType;
  if (req.body.discountValue !== undefined && dt && dt !== "free_shipping") {
    const dv = Number(req.body.discountValue);
    if (isNaN(dv) || dv < 0) {
      throw ApiError.badRequest("Discount value must be 0 or greater");
    }
    if (dt === "percentage" && dv > 100) {
      throw ApiError.badRequest("Percentage discount cannot exceed 100");
    }
  }

  if (req.body.label !== undefined) prize.label = String(req.body.label).slice(0, 50);
  if (req.body.discountType !== undefined) prize.discountType = req.body.discountType;
  if (req.body.discountValue !== undefined) prize.discountValue = Number(req.body.discountValue);
  if (req.body.color !== undefined) prize.color = req.body.color;
  if (req.body.textColor !== undefined) prize.textColor = req.body.textColor;
  if (req.body.isActive !== undefined) prize.isActive = req.body.isActive;

  // If value is being changed, check for duplicates
  if (req.body.value !== undefined && req.body.value !== prize.value) {
    const cleanValue = String(req.body.value).toLowerCase().trim();
    const existing = await SpinWheelPrize.findOne({ value: cleanValue, _id: { $ne: prize._id } });
    if (existing) {
      throw ApiError.conflict(`Prize with value "${cleanValue}" already exists`);
    }
    prize.value = cleanValue;
  }

  await prize.save();
  res.json(ApiResponse.ok({ prize }, "Prize updated"));
});

// DELETE /api/admin/spin-wheel/prizes/:id
const deletePrize = asyncHandler(async (req, res) => {
  const prize = await SpinWheelPrize.findByIdAndDelete(req.params.id);
  if (!prize) {
    throw ApiError.notFound("Prize not found");
  }
  res.json(ApiResponse.ok(null, "Prize deleted"));
});

// GET /api/admin/spin-wheel/entries
const listEntries = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;

  const filter = {};
  if (search) {
    filter.email = { $regex: search, $options: "i" };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [entries, total] = await Promise.all([
    SpinWheelEntry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("user", "fullName email")
      .lean(),
    SpinWheelEntry.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      entries,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// PATCH /api/admin/spin-wheel/toggle
const toggleSpinWheel = asyncHandler(async (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== "boolean") {
    throw ApiError.badRequest("enabled must be a boolean");
  }

  await Settings.findOneAndUpdate(
    { key: "spinWheelEnabled" },
    { key: "spinWheelEnabled", value: enabled },
    { upsert: true }
  );

  invalidateSettingsCache();

  res.json(ApiResponse.ok({ enabled }, `Spin wheel ${enabled ? "enabled" : "disabled"}`));
});

module.exports = { listPrizes, createPrize, updatePrize, deletePrize, listEntries, toggleSpinWheel };
