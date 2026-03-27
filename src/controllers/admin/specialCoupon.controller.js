const SpecialCoupon = require("../../models/SpecialCoupon");
const Coupon = require("../../models/Coupon");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");

const PROMOTION_TYPE_LABELS = {
  bxgy: "Buy X Get Y",
  volume_discount: "Volume Discount",
  spend_threshold: "Spend Threshold",
  fixed_price_bundle: "Fixed Price Bundle",
  free_gift: "Free Gift",
  tiered_shipping: "Tiered Shipping",
};

// GET /api/admin/special-coupons
const listSpecialCoupons = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    search,
    promotionType,
    applicationMethod,
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

  if (promotionType) {
    filter.promotionType = promotionType;
  }

  if (applicationMethod) {
    filter.applicationMethod = applicationMethod;
  }

  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } },
    ];
    // If we already have $or from status filter, combine
    if (status === "expired") {
      const statusOr = [
        { isActive: false },
        { validTill: { $lt: new Date() } },
      ];
      delete filter.$or;
      filter.$and = [
        { $or: statusOr },
        {
          $or: [
            { title: { $regex: search, $options: "i" } },
            { code: { $regex: search, $options: "i" } },
          ],
        },
      ];
    }
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [promotions, total] = await Promise.all([
    SpecialCoupon.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    SpecialCoupon.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      promotions,
      promotionTypeLabels: PROMOTION_TYPE_LABELS,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/special-coupons/:id
const getSpecialCoupon = asyncHandler(async (req, res) => {
  const promotion = await SpecialCoupon.findById(req.params.id)
    .populate("buyCondition.productIds", "name slug price images")
    .populate("buyCondition.categoryIds", "name slug")
    .populate("getReward.productIds", "name slug price images")
    .populate("fixedPriceBundle.productIds", "name slug price images")
    .populate("freeGift.productId", "name slug price images")
    .populate("excludeWithOther", "title code promotionType")
    .lean();

  if (!promotion) {
    throw ApiError.notFound("Promotion not found");
  }

  res.json(ApiResponse.ok({ promotion }));
});

// POST /api/admin/special-coupons
const createSpecialCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    title,
    description,
    promotionType,
    applicationMethod,
    buyCondition,
    getReward,
    volumeTiers,
    fixedPriceBundle,
    freeGift,
    shippingTier,
    validFrom,
    validTill,
    usageLimit,
    perUserLimit,
    isFirstOrderOnly,
    minOrderValue,
    maxOrderValue,
    customerEligibility,
    eligibleCustomerIds,
    eligibleTags,
    stackable,
    stackGroup,
    excludeWithCoupons,
    excludeWithOther,
    priority,
    maxDiscountPerOrder,
    isActive,
    notes,
  } = req.body;

  // Required fields
  if (!title || !promotionType || !applicationMethod || !validTill) {
    throw ApiError.badRequest(
      "title, promotionType, applicationMethod, and validTill are required"
    );
  }

  // Date validation
  if (validFrom && validTill && new Date(validFrom) >= new Date(validTill)) {
    throw ApiError.badRequest("Valid Till must be after Valid From");
  }

  // Code required if method is "code"
  if (applicationMethod === "code") {
    if (!code || !code.trim()) {
      throw ApiError.badRequest("Coupon code is required for code-based promotions");
    }

    // Check uniqueness across both collections
    const upperCode = code.trim().toUpperCase();
    const [existingSpecial, existingRegular] = await Promise.all([
      SpecialCoupon.findOne({ code: upperCode }),
      Coupon.findOne({ code: upperCode }),
    ]);

    if (existingSpecial) {
      throw ApiError.conflict(`Special coupon with code "${upperCode}" already exists`);
    }
    if (existingRegular) {
      throw ApiError.conflict(
        `A regular coupon with code "${upperCode}" already exists. Codes must be unique across all coupon types.`
      );
    }
  }

  // Type-specific validations
  validatePromotionTypeFields(promotionType, req.body);

  const promotion = await SpecialCoupon.create({
    code: applicationMethod === "code" ? code.trim().toUpperCase() : null,
    title: title.trim(),
    description: (description || "").trim(),
    promotionType,
    applicationMethod,
    buyCondition: buyCondition || {},
    getReward: getReward || {},
    volumeTiers: volumeTiers || [],
    fixedPriceBundle: fixedPriceBundle || {},
    freeGift: freeGift || {},
    shippingTier: shippingTier || {},
    validFrom: validFrom || new Date(),
    validTill,
    usageLimit: usageLimit || undefined,
    perUserLimit: perUserLimit ?? 1,
    isFirstOrderOnly: isFirstOrderOnly || false,
    minOrderValue: minOrderValue || 0,
    maxOrderValue: maxOrderValue || undefined,
    customerEligibility: customerEligibility || "all",
    eligibleCustomerIds: eligibleCustomerIds || [],
    eligibleTags: eligibleTags || [],
    stackable: stackable || false,
    stackGroup: stackGroup || undefined,
    excludeWithCoupons: excludeWithCoupons !== false,
    excludeWithOther: excludeWithOther || [],
    priority: priority || 0,
    maxDiscountPerOrder: maxDiscountPerOrder || undefined,
    isActive: isActive !== false,
    createdBy: req.user._id,
    notes: notes || undefined,
  });

  res.status(201).json(ApiResponse.created({ promotion }));
});

// PATCH /api/admin/special-coupons/:id
const updateSpecialCoupon = asyncHandler(async (req, res) => {
  const promotion = await SpecialCoupon.findById(req.params.id);

  if (!promotion) {
    throw ApiError.notFound("Promotion not found");
  }

  // If code is being updated, check uniqueness
  if (req.body.code !== undefined) {
    if (req.body.code) {
      const upperCode = req.body.code.trim().toUpperCase();
      if (upperCode !== promotion.code) {
        const [existingSpecial, existingRegular] = await Promise.all([
          SpecialCoupon.findOne({ code: upperCode, _id: { $ne: promotion._id } }),
          Coupon.findOne({ code: upperCode }),
        ]);

        if (existingSpecial) {
          throw ApiError.conflict(`Special coupon with code "${upperCode}" already exists`);
        }
        if (existingRegular) {
          throw ApiError.conflict(
            `A regular coupon with code "${upperCode}" already exists`
          );
        }
      }
      req.body.code = upperCode;
    } else if (promotion.applicationMethod === "code" && !req.body.applicationMethod) {
      throw ApiError.badRequest("Code is required for code-based promotions");
    }
  }

  // If promotionType is being changed, validate new fields
  const effectiveType = req.body.promotionType || promotion.promotionType;
  if (req.body.promotionType || req.body.buyCondition || req.body.getReward ||
      req.body.volumeTiers || req.body.fixedPriceBundle || req.body.freeGift ||
      req.body.shippingTier) {
    validatePromotionTypeFields(effectiveType, {
      ...promotion.toObject(),
      ...req.body,
    });
  }

  const allowedFields = [
    "code", "title", "description", "promotionType", "applicationMethod",
    "buyCondition", "getReward", "volumeTiers", "fixedPriceBundle",
    "freeGift", "shippingTier", "validFrom", "validTill", "usageLimit",
    "perUserLimit", "isFirstOrderOnly", "minOrderValue", "maxOrderValue",
    "customerEligibility", "eligibleCustomerIds", "eligibleTags",
    "stackable", "stackGroup", "excludeWithCoupons", "excludeWithOther",
    "priority", "maxDiscountPerOrder", "isActive", "notes",
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      promotion[field] = req.body[field];
    }
  }

  // If switched to automatic, clear code
  if (promotion.applicationMethod === "automatic") {
    promotion.code = null;
  }

  await promotion.save();

  res.json(ApiResponse.ok({ promotion }, "Promotion updated"));
});

// DELETE /api/admin/special-coupons/:id
const deleteSpecialCoupon = asyncHandler(async (req, res) => {
  const promotion = await SpecialCoupon.findByIdAndDelete(req.params.id);

  if (!promotion) {
    throw ApiError.notFound("Promotion not found");
  }

  res.json(ApiResponse.ok(null, "Promotion deleted"));
});

// POST /api/admin/special-coupons/:id/clone
const cloneSpecialCoupon = asyncHandler(async (req, res) => {
  const source = await SpecialCoupon.findById(req.params.id).lean();

  if (!source) {
    throw ApiError.notFound("Promotion not found");
  }

  // Remove fields that shouldn't be cloned
  delete source._id;
  delete source.__v;
  delete source.createdAt;
  delete source.updatedAt;
  delete source.usageCount;
  delete source.usedBy;

  // Append " (Copy)" to title and modify code
  source.title = `${source.title} (Copy)`;
  if (source.code) {
    source.code = `${source.code}_COPY`;
    // Check uniqueness
    const existing = await SpecialCoupon.findOne({ code: source.code });
    if (existing) {
      source.code = `${source.code}_${Date.now()}`;
    }
  }
  source.isActive = false; // Clone starts as inactive
  source.createdBy = req.user._id;

  const promotion = await SpecialCoupon.create(source);

  res.status(201).json(ApiResponse.created({ promotion }));
});

// GET /api/admin/special-coupons/:id/usage
const getSpecialCouponUsage = asyncHandler(async (req, res) => {
  const promotion = await SpecialCoupon.findById(req.params.id)
    .populate("usedBy.user", "name email phone")
    .lean();

  if (!promotion) {
    throw ApiError.notFound("Promotion not found");
  }

  res.json(
    ApiResponse.ok({
      usageCount: promotion.usageCount,
      usageLimit: promotion.usageLimit,
      usedBy: promotion.usedBy || [],
    })
  );
});

// --- Validation Helpers ---

function validatePromotionTypeFields(type, data) {
  switch (type) {
    case "bxgy": {
      if (!data.buyCondition?.type) {
        throw ApiError.badRequest("Buy condition type is required for BXGY promotions");
      }
      if (!data.buyCondition?.minQuantity || data.buyCondition.minQuantity < 1) {
        throw ApiError.badRequest("Buy condition minimum quantity is required for BXGY");
      }
      if (!data.getReward?.type) {
        throw ApiError.badRequest("Reward type is required for BXGY promotions");
      }
      if (!data.getReward?.quantity || data.getReward.quantity < 1) {
        throw ApiError.badRequest("Reward quantity is required for BXGY promotions");
      }
      if (data.buyCondition.type === "product" &&
          (!data.buyCondition.productIds || data.buyCondition.productIds.length === 0)) {
        throw ApiError.badRequest("Product IDs required when buy condition type is 'product'");
      }
      if (data.buyCondition.type === "category" &&
          (!data.buyCondition.categoryIds || data.buyCondition.categoryIds.length === 0)) {
        throw ApiError.badRequest("Category IDs required when buy condition type is 'category'");
      }
      break;
    }

    case "volume_discount": {
      if (!data.volumeTiers || data.volumeTiers.length < 2) {
        throw ApiError.badRequest("At least 2 volume tiers required for volume discount");
      }
      // Ensure tiers are sorted by minQuantity ascending
      const sorted = [...data.volumeTiers].sort((a, b) => a.minQuantity - b.minQuantity);
      for (let i = 0; i < sorted.length; i++) {
        if (!sorted[i].minQuantity || sorted[i].minQuantity < 1) {
          throw ApiError.badRequest("Each tier must have a minQuantity >= 1");
        }
        if (sorted[i].discountValue == null || sorted[i].discountValue < 0) {
          throw ApiError.badRequest("Each tier must have a valid discountValue");
        }
        if (i > 0 && sorted[i].minQuantity <= sorted[i - 1].minQuantity) {
          throw ApiError.badRequest("Volume tiers must have unique, ascending minQuantity values");
        }
      }
      break;
    }

    case "spend_threshold": {
      if (!data.buyCondition?.minAmount || data.buyCondition.minAmount <= 0) {
        throw ApiError.badRequest("Minimum spend amount required for spend threshold promotions");
      }
      if (!data.getReward?.type) {
        throw ApiError.badRequest("Reward type is required for spend threshold promotions");
      }
      break;
    }

    case "fixed_price_bundle": {
      if (!data.fixedPriceBundle?.productIds || data.fixedPriceBundle.productIds.length < 2) {
        throw ApiError.badRequest("At least 2 products required for a fixed price bundle");
      }
      if (data.fixedPriceBundle.fixedPrice == null || data.fixedPriceBundle.fixedPrice <= 0) {
        throw ApiError.badRequest("Fixed price must be greater than 0");
      }
      if (data.fixedPriceBundle.quantities &&
          data.fixedPriceBundle.quantities.length !== data.fixedPriceBundle.productIds.length) {
        throw ApiError.badRequest("Quantities array must match productIds array length");
      }
      break;
    }

    case "free_gift": {
      if (!data.freeGift?.productId) {
        throw ApiError.badRequest("Gift product is required for free gift promotions");
      }
      break;
    }

    case "tiered_shipping": {
      if (!data.shippingTier?.discountType) {
        throw ApiError.badRequest("Shipping discount type required for tiered shipping");
      }
      if (data.shippingTier.discountValue == null || data.shippingTier.discountValue < 0) {
        throw ApiError.badRequest("Shipping discount value must be >= 0");
      }
      if (data.shippingTier.discountType === "percentage" && data.shippingTier.discountValue > 100) {
        throw ApiError.badRequest("Shipping percentage discount cannot exceed 100%");
      }
      break;
    }

    default:
      throw ApiError.badRequest(`Invalid promotion type: ${type}`);
  }
}

module.exports = {
  listSpecialCoupons,
  getSpecialCoupon,
  createSpecialCoupon,
  updateSpecialCoupon,
  deleteSpecialCoupon,
  cloneSpecialCoupon,
  getSpecialCouponUsage,
};
