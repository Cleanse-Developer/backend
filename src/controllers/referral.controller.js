const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");
const Referral = require("../models/Referral");
const generateReferralCode = require("../utils/generateReferralCode");
const { getReferralConfig } = require("../services/referral.service");

// GET /api/referral/code
const getReferralCode = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  // Generate referral code if user doesn't have one
  if (!user.referralCode) {
    user.referralCode = await generateReferralCode();
    await user.save();
  }

  const config = await getReferralConfig();

  // Aggregate referral stats
  const [totalReferrals, successfulReferrals, pendingReferrals] = await Promise.all([
    Referral.countDocuments({ referrer: user._id }),
    Referral.countDocuments({ referrer: user._id, isRewarded: true }),
    Referral.countDocuments({ referrer: user._id, isRewarded: false }),
  ]);

  // Total earned (sum of rewardAmount for rewarded referrals)
  const earnedAgg = await Referral.aggregate([
    { $match: { referrer: user._id, isRewarded: true } },
    { $group: { _id: null, total: { $sum: "$rewardAmount" } } },
  ]);
  const totalEarned = earnedAgg[0]?.total || 0;

  res.status(200).json(
    new ApiResponse(200, {
      referralCode: user.referralCode,
      config,
      stats: {
        totalReferrals,
        successfulReferrals,
        pendingReferrals,
        totalEarned,
      },
    })
  );
});

// POST /api/referral/validate (public)
// Body: { code }
const validateReferralCode = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    throw ApiError.badRequest("Code is required");
  }

  const config = await getReferralConfig();
  if (!config.enabled) {
    return res.json(
      new ApiResponse(200, { valid: false, message: "Referral program is currently disabled" })
    );
  }

  const normalized = code.trim().toUpperCase();
  const referrer = await User.findOne({ referralCode: normalized }).select("fullName");

  if (!referrer) {
    return res.json(
      new ApiResponse(200, { valid: false, message: "Invalid referral code" })
    );
  }

  // Returns first name only for privacy
  const firstName = (referrer.fullName || "").split(" ")[0] || "a friend";

  res.json(
    new ApiResponse(200, {
      valid: true,
      referrerName: firstName,
      refereeRewardValue:
        config.rewardMode === "loyalty_points_both" || config.rewardMode === "coupon_both"
          ? config.refereeRewardValue
          : 0,
      refereeRewardType:
        config.rewardMode === "coupon_both"
          ? config.refereeCouponDiscountType
          : config.rewardMode === "loyalty_points_both"
            ? "loyalty_points"
            : null,
    })
  );
});

// GET /api/referral/history (auth)
const getReferralHistory = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [referrals, total] = await Promise.all([
    Referral.find({ referrer: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("referee", "fullName email")
      .populate("qualifyingOrder", "orderId")
      .lean(),
    Referral.countDocuments({ referrer: req.user._id }),
  ]);

  res.json(
    new ApiResponse(200, {
      referrals,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    })
  );
});

module.exports = { getReferralCode, validateReferralCode, getReferralHistory };
