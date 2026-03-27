const SpecialCoupon = require("../models/SpecialCoupon");
const Cart = require("../models/Cart");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const { validateSpecialCouponCode } = require("../services/specialCoupon.service");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes",
};

// POST /api/special-coupons/validate
const validateCode = asyncHandler(async (req, res) => {
  const { code, cartSubtotal } = req.body;

  if (!code) {
    return res.json(
      ApiResponse.ok({ valid: false, message: "Promotion code is required" })
    );
  }

  // Get user's cart to evaluate buy conditions
  let cartItems = [];
  if (req.user) {
    const cart = await Cart.findOne({ user: req.user._id }).populate(POPULATE_PRODUCT);
    if (cart && cart.items.length > 0) {
      cartItems = cart.items;
    }
  }

  const result = await validateSpecialCouponCode(
    code,
    cartItems,
    req.user?._id || null,
    cartSubtotal || 0
  );

  if (result.valid) {
    res.json(
      ApiResponse.ok({
        valid: true,
        promotionType: result.promotion.promotionType,
        title: result.promotion.title,
        description: result.promotion.description,
        message: result.message,
      })
    );
  } else {
    res.json(ApiResponse.ok({ valid: false, message: result.message }));
  }
});

// GET /api/special-coupons/active-promotions
const getActivePromotions = asyncHandler(async (req, res) => {
  const now = new Date();
  const promotions = await SpecialCoupon.find({
    isActive: true,
    applicationMethod: "automatic",
    validFrom: { $lte: now },
    validTill: { $gte: now },
  })
    .select("title description promotionType buyCondition getReward volumeTiers freeGift fixedPriceBundle shippingTier")
    .sort({ priority: -1 })
    .limit(20)
    .lean();

  res.json(ApiResponse.ok({ promotions }));
});

module.exports = { validateCode, getActivePromotions };
