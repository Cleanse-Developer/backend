const Coupon = require("../models/Coupon");
const Cart = require("../models/Cart");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { validateCoupon: validateCouponService } = require("../services/coupon.service");

// POST /api/coupons/validate
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, cartSubtotal } = req.body;

  if (!code) {
    throw ApiError.badRequest("Coupon code is required");
  }

  if (cartSubtotal == null || cartSubtotal < 0) {
    throw ApiError.badRequest("Valid cart subtotal is required");
  }

  // Guests have no server-side cart; load it only for authenticated users.
  const userId = req.user?._id || null;

  let cartItems = [];
  if (userId) {
    // Load user's cart with populated products for applicableProducts/applicableCategories filtering
    const cart = await Cart.findOne({ user: userId }).populate({
      path: "items.product",
      select: "_id price category",
    });
    cartItems = cart?.items || [];
  }

  const result = await validateCouponService(
    code,
    userId,
    cartSubtotal,
    undefined, // effectiveSubtotal not available at preview time
    cartItems
  );

  res.json(
    ApiResponse.ok({
      valid: result.valid,
      discount: result.discount,
      discountType: result.discountType,
      description: result.description,
      message: result.message,
    })
  );
});

// GET /api/coupons/my-coupons
const getMyCoupons = asyncHandler(async (req, res) => {
  const now = new Date();
  const userId = req.user._id;

  const coupons = await Coupon.find({
    isActive: true,
    validTill: { $gte: now },
    validFrom: { $lte: now },
    $or: [
      { usageLimit: { $exists: false } },
      { usageLimit: null },
      { $expr: { $lt: ["$usageCount", "$usageLimit"] } },
    ],
  }).select(
    "code description discountType discountValue minOrderValue maxDiscountAmount validTill perUserLimit usedBy"
  );

  // Filter out coupons where user has exceeded their per-user limit
  const available = coupons
    .filter((coupon) => {
      const userUsageCount = coupon.usedBy
        ? coupon.usedBy.filter(
            (entry) => entry.user && entry.user.toString() === userId.toString()
          ).length
        : 0;
      return userUsageCount < coupon.perUserLimit;
    })
    // Strip the usedBy field from the response (only used internally for filter)
    .map((c) => {
      const obj = c.toObject();
      delete obj.usedBy;
      return obj;
    });

  res.json(ApiResponse.ok({ coupons: available }));
});

module.exports = { validateCoupon, getMyCoupons };
