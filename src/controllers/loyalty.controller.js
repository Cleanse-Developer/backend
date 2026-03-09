const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");

const getBalance = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("loyaltyPoints");

  const recentTransactions = await LoyaltyTransaction.find({
    user: req.user._id,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("order", "orderId");

  res.status(200).json(
    new ApiResponse(200, {
      loyaltyPoints: user.loyaltyPoints,
      recentTransactions,
    })
  );
});

module.exports = { getBalance };
