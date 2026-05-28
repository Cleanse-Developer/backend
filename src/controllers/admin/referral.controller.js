const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const Referral = require("../../models/Referral");
const User = require("../../models/User");
const Coupon = require("../../models/Coupon");
const { paginationMeta } = require("../../utils/pagination");
const {
  getReferralConfig,
  reverseReferralReward,
} = require("../../services/referral.service");
const { awardPoints } = require("../../services/loyalty.service");

// GET /api/admin/referrals
const listReferrals = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const status = req.query.status; // "rewarded" | "pending" | undefined
  const search = (req.query.search || "").trim();

  const filter = {};
  if (status === "rewarded") filter.isRewarded = true;
  else if (status === "pending") filter.isRewarded = false;

  // Search filter requires lookup of user emails first
  let userIds = null;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = await User.find({
      $or: [
        { email: { $regex: escaped, $options: "i" } },
        { fullName: { $regex: escaped, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();
    userIds = matched.map((u) => u._id);
    if (userIds.length === 0) {
      return res.json(
        ApiResponse.ok({
          referrals: [],
          pagination: paginationMeta(0, page, limit),
        })
      );
    }
    filter.$or = [{ referrer: { $in: userIds } }, { referee: { $in: userIds } }];
  }

  const [referrals, total] = await Promise.all([
    Referral.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("referrer", "fullName email")
      .populate("referee", "fullName email")
      .populate("qualifyingOrder", "orderId pricing.total status")
      .lean(),
    Referral.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      referrals,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// GET /api/admin/referrals/stats
const getReferralStats = asyncHandler(async (req, res) => {
  const [total, rewarded, pending] = await Promise.all([
    Referral.countDocuments({}),
    Referral.countDocuments({ isRewarded: true }),
    Referral.countDocuments({ isRewarded: false }),
  ]);

  const earnedAgg = await Referral.aggregate([
    { $match: { isRewarded: true } },
    { $group: { _id: null, total: { $sum: "$rewardAmount" } } },
  ]);

  res.json(
    ApiResponse.ok({
      total,
      rewarded,
      pending,
      totalRewardValue: earnedAgg[0]?.total || 0,
    })
  );
});

// POST /api/admin/referrals/:id/mark-rewarded
// Manually mark a referral as rewarded — admin override for dispute resolution.
// Bypasses the "first order" check and forcibly issues the configured reward.
const markRewarded = asyncHandler(async (req, res) => {
  const referral = await Referral.findById(req.params.id);
  if (!referral) throw ApiError.notFound("Referral not found");
  if (referral.isRewarded) {
    throw ApiError.conflict("Referral is already rewarded");
  }

  const config = await getReferralConfig();
  const referrer = await User.findById(referral.referrer).select("_id email fullName");
  if (!referrer) throw ApiError.notFound("Referrer account no longer exists");

  // Find the most recent qualifying order (for audit linking only — NOT used
  // to gate the reward; admin is overriding any first-order check).
  const Order = require("../../models/Order");
  const recentOrder = await Order.findOne({
    user: referral.referee,
    status: { $in: ["confirmed", "processing", "packed", "shipped", "in_transit", "out_for_delivery", "delivered"] },
  })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();

  // Issue the reward according to the CURRENT config
  const isCouponMode =
    config.rewardMode === "coupon_referrer" || config.rewardMode === "coupon_both";

  if (config.referrerRewardValue > 0) {
    if (isCouponMode) {
      const code = await (async () => {
        const crypto = require("crypto");
        for (let i = 0; i < 20; i++) {
          const c = `REF-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
          if (!(await Coupon.exists({ code: c }))) return c;
        }
        throw new Error("Failed to generate unique referral coupon code");
      })();
      await Coupon.create({
        code,
        description: `Referral reward (admin-issued): ${config.referrerRewardValue}${
          config.referrerCouponDiscountType === "percentage" ? "%" : "₹"
        } off [user:${referrer._id}]`,
        discountType:
          config.referrerCouponDiscountType === "percentage" ? "percentage" : "fixed",
        discountValue: config.referrerRewardValue,
        minOrderValue: 0,
        validFrom: new Date(),
        validTill: new Date(
          Date.now() + (config.couponValidityDays || 30) * 24 * 60 * 60 * 1000
        ),
        usageLimit: 1,
        usageCount: 0,
        perUserLimit: 1,
        isActive: true,
      });
    } else {
      await awardPoints(
        referrer._id,
        config.referrerRewardValue,
        recentOrder?._id || null,
        `Admin-issued referral bonus (referee: ${referral.referee})`,
        "referral_bonus"
      );
    }
  }

  // Mark referral consumed
  referral.isRewarded = true;
  referral.qualifyingOrder = recentOrder?._id;
  referral.rewardedAt = new Date();
  referral.rewardAmount = config.referrerRewardValue;
  await referral.save();

  res.json(ApiResponse.ok({ referral }, "Referral marked as rewarded"));
});

// POST /api/admin/referrals/:id/reverse
const reverseReferral = asyncHandler(async (req, res) => {
  const referral = await Referral.findById(req.params.id);
  if (!referral) throw ApiError.notFound("Referral not found");
  if (!referral.isRewarded) {
    throw ApiError.badRequest("Referral is not currently rewarded");
  }
  if (referral.rewardReversedAt) {
    throw ApiError.badRequest("Referral reward has already been reversed");
  }

  if (referral.qualifyingOrder) {
    await reverseReferralReward(referral.qualifyingOrder);
  } else {
    // Manually-issued reward (no qualifying order). Find and reverse directly.
    const config = await getReferralConfig();
    const isCouponMode =
      config.rewardMode === "coupon_referrer" || config.rewardMode === "coupon_both";

    if (referral.rewardAmount > 0) {
      if (isCouponMode) {
        await Coupon.updateMany(
          {
            description: { $regex: `\\[user:${referral.referrer}\\]` },
            code: { $regex: "^REF-" },
            isActive: true,
            usageCount: 0,
          },
          { $set: { isActive: false } }
        );
      } else {
        const { reversePoints } = require("../../services/loyalty.service");
        await reversePoints(
          referral.referrer,
          referral.rewardAmount,
          null,
          "Admin-reversed referral bonus"
        );
      }
    }

    referral.rewardReversedAt = new Date();
    await referral.save();
  }

  const updated = await Referral.findById(referral._id);
  res.json(ApiResponse.ok({ referral: updated }, "Referral reward reversed"));
});

module.exports = {
  listReferrals,
  getReferralStats,
  markRewarded,
  reverseReferral,
};
