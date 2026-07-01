const Coupon = require("../../models/Coupon");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");

// GET /api/admin/coupons
const listCoupons = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    search,
    source,
    expired,
  } = req.query;

  const filter = {};

  if (status === "active") {
    filter.isActive = true;
    filter.validTill = { $gte: new Date() };
  } else if (status === "expired") {
    filter.$or = [
      { isActive: false },
      { validTill: { $lt: new Date() } },
    ];
  }
  // "all" or no status: no filter

  // Time-based expiry filter (independent of isActive)
  if (expired === "true") {
    filter.validTill = { $lt: new Date() };
  } else if (expired === "false") {
    filter.validTill = { $gte: new Date() };
  }

  // Source split via code prefix. Spin-wheel coupons are code "SPIN-...";
  // "general" = everything else (manual + newsletter + referral).
  const SPIN_PREFIX = { $regex: "^SPIN-", $options: "i" };
  const codeConds = [];
  if (search) codeConds.push({ $regex: search, $options: "i" });
  if (source === "spin") codeConds.push(SPIN_PREFIX);
  else if (source === "general") codeConds.push({ $not: SPIN_PREFIX });

  if (codeConds.length === 1) {
    filter.code = codeConds[0];
  } else if (codeConds.length > 1) {
    filter.$and = codeConds.map((c) => ({ code: c }));
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [coupons, total] = await Promise.all([
    Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Coupon.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      coupons,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// POST /api/admin/coupons
const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    description,
    discountType,
    discountValue,
    minOrderValue,
    maxDiscountAmount,
    validFrom,
    validTill,
    usageLimit,
    perUserLimit,
    isActive,
    isFirstOrderOnly,
    applicableProducts,
    applicableCategories,
  } = req.body;

  if (!code || !description || !discountType || discountValue == null || !validTill) {
    throw ApiError.badRequest(
      "code, description, discountType, discountValue, and validTill are required"
    );
  }

  const existing = await Coupon.findOne({ code: code.toUpperCase() });
  if (existing) {
    throw ApiError.conflict(`Coupon with code "${code.toUpperCase()}" already exists`);
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase(),
    description,
    discountType,
    discountValue,
    minOrderValue,
    maxDiscountAmount,
    validFrom,
    validTill,
    usageLimit,
    perUserLimit,
    isActive,
    isFirstOrderOnly,
    applicableProducts,
    applicableCategories,
  });

  res.status(201).json(ApiResponse.created({ coupon }));
});

// PATCH /api/admin/coupons/:id
const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);

  if (!coupon) {
    throw ApiError.notFound("Coupon not found");
  }

  // If code is being updated, uppercase it and check for duplicates
  if (req.body.code) {
    req.body.code = req.body.code.toUpperCase();
    if (req.body.code !== coupon.code) {
      const existing = await Coupon.findOne({ code: req.body.code });
      if (existing) {
        throw ApiError.conflict(
          `Coupon with code "${req.body.code}" already exists`
        );
      }
    }
  }

  const allowedFields = [
    "code",
    "description",
    "discountType",
    "discountValue",
    "minOrderValue",
    "maxDiscountAmount",
    "validFrom",
    "validTill",
    "usageLimit",
    "perUserLimit",
    "isActive",
    "isFirstOrderOnly",
    "applicableProducts",
    "applicableCategories",
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      coupon[field] = req.body[field];
    }
  }

  await coupon.save();

  res.json(ApiResponse.ok({ coupon }, "Coupon updated"));
});

// DELETE /api/admin/coupons/:id
const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);

  if (!coupon) {
    throw ApiError.notFound("Coupon not found");
  }

  res.json(ApiResponse.ok(null, "Coupon deleted"));
});

module.exports = { listCoupons, createCoupon, updateCoupon, deleteCoupon };
