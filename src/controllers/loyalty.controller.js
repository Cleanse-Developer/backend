const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const {
  getLoyaltyConfig,
  validateRedemption,
  calculateMaxRedeemable,
} = require("../services/loyalty.service");

// GET /api/loyalty/balance
const getBalance = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("loyaltyPoints");

  const recentTransactions = await LoyaltyTransaction.find({
    user: req.user._id,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("order", "orderId");

  const config = await getLoyaltyConfig();

  res.status(200).json(
    new ApiResponse(200, {
      loyaltyPoints: user.loyaltyPoints,
      recentTransactions,
      config,
    })
  );
});

// GET /api/loyalty/transactions?page=1&limit=20
const getTransactions = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    LoyaltyTransaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("order", "orderId"),
    LoyaltyTransaction.countDocuments({ user: req.user._id }),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      transactions,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    })
  );
});

// POST /api/loyalty/redeem/preview
// Body: { points, subtotal }
const getRedeemPreview = asyncHandler(async (req, res) => {
  const { points, subtotal } = req.body;

  if (subtotal === undefined || subtotal === null) {
    throw ApiError.badRequest("subtotal is required");
  }

  const result = await validateRedemption(
    req.user._id,
    Number(points) || 0,
    Number(subtotal) || 0
  );

  res.status(200).json(new ApiResponse(200, result));
});

// GET /api/loyalty/max-redeemable?subtotal=1000
const getMaxRedeemable = asyncHandler(async (req, res) => {
  const subtotal = Number(req.query.subtotal) || 0;
  const config = await getLoyaltyConfig();
  const user = await User.findById(req.user._id).select("loyaltyPoints").lean();

  const result = calculateMaxRedeemable(
    user?.loyaltyPoints || 0,
    subtotal,
    config
  );

  res.status(200).json(
    new ApiResponse(200, {
      ...result,
      balance: user?.loyaltyPoints || 0,
      config,
    })
  );
});

module.exports = {
  getBalance,
  getTransactions,
  getRedeemPreview,
  getMaxRedeemable,
};
