const Settings = require("../models/Settings");
const User = require("../models/User");
const Referral = require("../models/Referral");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const { awardPoints, reversePoints } = require("./loyalty.service");

const DEFAULT_CONFIG = {
  enabled: true,
  rewardMode: "loyalty_points_referrer",
  referrerRewardValue: 200,
  refereeRewardValue: 100,
  referrerCouponDiscountType: "fixed",
  refereeCouponDiscountType: "fixed",
  couponValidityDays: 30,
  qualifyingOrderMinValue: 0,
  codePrefix: "CLEANSE-",
};

const VALID_MODES = [
  "loyalty_points_referrer",
  "loyalty_points_both",
  "coupon_referrer",
  "coupon_both",
];

const getReferralConfig = async () => {
  const doc = await Settings.findOne({ key: "referral_config" }).lean();
  if (!doc?.value) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...doc.value };
};

const modeIncludesReferrer = (mode) =>
  mode === "loyalty_points_referrer" ||
  mode === "loyalty_points_both" ||
  mode === "coupon_referrer" ||
  mode === "coupon_both";

const modeIncludesReferee = (mode) =>
  mode === "loyalty_points_both" || mode === "coupon_both";

const modeIsCoupon = (mode) =>
  mode === "coupon_referrer" || mode === "coupon_both";

/**
 * Generate a unique referral coupon code. 4-byte hex = ~4.3B possible codes;
 * collisions are extraordinarily unlikely but we still retry up to 20 times.
 */
const generateReferralCouponCode = async () => {
  const crypto = require("crypto");
  for (let i = 0; i < 20; i++) {
    // After 10 attempts, widen to 6 bytes for extra safety
    const bytes = i < 10 ? 4 : 6;
    const code = `REF-${crypto.randomBytes(bytes).toString("hex").toUpperCase()}`;
    const exists = await Coupon.exists({ code });
    if (!exists) return code;
  }
  throw new Error("Failed to generate unique referral coupon code after 20 attempts");
};

/**
 * Issue a coupon for either the referrer or referee.
 * Tags the coupon with `referralIssuedTo` (in description) so it can be found
 * for deactivation if the referral is later reversed.
 */
const issueReferralCoupon = async (userId, value, discountType, validityDays, label) => {
  const code = await generateReferralCouponCode();
  const validTill = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

  const couponData = {
    code,
    // Tag with userId so reverseReferralReward can find and deactivate it.
    description: `Referral reward: ${label} [user:${userId}]`,
    discountType: discountType === "percentage" ? "percentage" : "fixed",
    discountValue: value,
    minOrderValue: 0,
    validFrom: new Date(),
    validTill,
    usageLimit: 1,
    usageCount: 0,
    perUserLimit: 1,
    isActive: true,
  };

  return Coupon.create(couponData);
};

/**
 * Apply a referral code at signup. Creates a Referral record linking the new user
 * to the referrer, and (if config says so) credits the referee immediately with a
 * welcome reward.
 *
 * @param {object} newUser - The newly-created User document
 * @param {string} referralCode - The code provided at signup
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const applyReferralAtSignup = async (newUser, referralCode) => {
  if (!referralCode) return { success: false, message: "No code provided" };

  const config = await getReferralConfig();
  if (!config.enabled) {
    return { success: false, message: "Referral program is disabled" };
  }

  const code = String(referralCode).trim().toUpperCase();
  const referrer = await User.findOne({ referralCode: code });

  if (!referrer) {
    return { success: false, message: "Invalid referral code" };
  }
  if (referrer._id.toString() === newUser._id.toString()) {
    return { success: false, message: "Cannot use your own referral code" };
  }

  // Check if this user already has a referral record (shouldn't happen on signup, but be safe)
  const existing = await Referral.findOne({ referee: newUser._id });
  if (existing) {
    return { success: false, message: "User already has a referrer" };
  }

  // Set referredBy on the new user
  newUser.referredBy = referrer._id;
  await newUser.save();

  // Create referral record
  await Referral.create({
    referrer: referrer._id,
    referee: newUser._id,
    referralCode: code,
    rewardAmount: config.referrerRewardValue,
    isRewarded: false,
  });

  // Credit referee immediately if config says so
  if (modeIncludesReferee(config.rewardMode) && config.refereeRewardValue > 0) {
    if (modeIsCoupon(config.rewardMode)) {
      try {
        await issueReferralCoupon(
          newUser._id,
          config.refereeRewardValue,
          config.refereeCouponDiscountType,
          config.couponValidityDays,
          `Welcome ${config.refereeRewardValue}${config.refereeCouponDiscountType === "percentage" ? "%" : "₹"} off`
        );
      } catch (err) {
        console.error("Referral: failed to issue referee coupon:", err.message);
      }
    } else {
      await awardPoints(
        newUser._id,
        config.refereeRewardValue,
        null,
        `Welcome bonus for using referral code ${code}`,
        "referral_bonus"
      );
    }
  }

  return { success: true };
};

/**
 * Process a referral reward when the referee completes their first qualifying order.
 * Idempotent: safe to call multiple times.
 */
const processReferralReward = async (orderId, userId) => {
  const config = await getReferralConfig();
  if (!config.enabled) return { success: false, reason: "disabled" };

  const user = await User.findById(userId).select("referredBy fullName email");
  if (!user || !user.referredBy) {
    return { success: false, reason: "not_referred" };
  }

  const referral = await Referral.findOne({
    referee: userId,
    isRewarded: false,
  });
  if (!referral) {
    return { success: false, reason: "no_pending_referral" };
  }

  // Check that this is the user's first completed order
  const completedStatuses = ["confirmed", "processing", "packed", "shipped", "in_transit", "out_for_delivery", "delivered"];
  const completedOrders = await Order.countDocuments({
    user: userId,
    status: { $in: completedStatuses },
  });
  if (completedOrders > 1) {
    // Not the first qualifying order; skip
    return { success: false, reason: "not_first_order" };
  }

  // Check qualifying order min value
  if (config.qualifyingOrderMinValue > 0) {
    const order = await Order.findById(orderId).select("pricing").lean();
    if (!order || order.pricing.total < config.qualifyingOrderMinValue) {
      return { success: false, reason: "below_min_value" };
    }
  }

  const referrer = await User.findById(referral.referrer).select("_id email fullName");
  if (!referrer) {
    return { success: false, reason: "referrer_missing" };
  }

  // Credit referrer
  if (modeIncludesReferrer(config.rewardMode) && config.referrerRewardValue > 0) {
    if (modeIsCoupon(config.rewardMode)) {
      try {
        await issueReferralCoupon(
          referrer._id,
          config.referrerRewardValue,
          config.referrerCouponDiscountType,
          config.couponValidityDays,
          `Referral bonus ${config.referrerRewardValue}${config.referrerCouponDiscountType === "percentage" ? "%" : "₹"} off`
        );
      } catch (err) {
        console.error("Referral: failed to issue referrer coupon:", err.message);
        return { success: false, reason: "coupon_issue_failed" };
      }
    } else {
      await awardPoints(
        referrer._id,
        config.referrerRewardValue,
        orderId,
        `Referral bonus for ${user.fullName || user.email}'s first order`,
        "referral_bonus"
      );
    }
  }

  // Mark referral as rewarded
  referral.isRewarded = true;
  referral.qualifyingOrder = orderId;
  referral.rewardedAt = new Date();
  referral.rewardAmount = config.referrerRewardValue;
  await referral.save();

  // Best-effort: send email notification to referrer
  try {
    const { sendEmail } = require("./email.service");
    await sendEmail({
      to: referrer.email,
      subject: "You earned a referral reward!",
      html: `<p>Hi ${referrer.fullName || "there"},</p>
        <p>Your friend ${user.fullName || "a friend"} just completed their first order using your referral code.</p>
        <p>Your reward of <strong>${config.referrerRewardValue}${modeIsCoupon(config.rewardMode) ? (config.referrerCouponDiscountType === "percentage" ? "%" : "₹") + " off coupon" : " loyalty points"}</strong> has been added to your account.</p>
        <p>Thanks for spreading the love!</p>`,
    });
  } catch {
    // Non-critical
  }

  return { success: true, mode: config.rewardMode, value: config.referrerRewardValue };
};

/**
 * Reverse a referral reward when the qualifying order is cancelled.
 *
 * Important policy decisions:
 * - We reverse the points or deactivate the coupon (so referrer doesn't keep
 *   a reward for an order that was cancelled).
 * - We do NOT reset `isRewarded` — the referral is permanently consumed. A
 *   referee gets one shot at triggering the reward; cancelling/re-ordering
 *   does not give them another chance. This prevents abuse.
 * - We mark the reversal with a `rewardReversedAt` timestamp for audit.
 */
const reverseReferralReward = async (orderId) => {
  const referral = await Referral.findOne({
    qualifyingOrder: orderId,
    isRewarded: true,
  });
  if (!referral) return { success: false, reason: "not_found" };

  // Idempotency: if already reversed, no-op
  if (referral.rewardReversedAt) {
    return { success: false, reason: "already_reversed" };
  }

  const config = await getReferralConfig();

  // Reverse the referrer's reward
  if (modeIncludesReferrer(config.rewardMode) && referral.rewardAmount > 0) {
    if (modeIsCoupon(config.rewardMode)) {
      // Find and deactivate the referral coupon issued to this referrer.
      // We tag coupons with `[user:<id>]` in description for findability.
      try {
        await Coupon.updateMany(
          {
            description: { $regex: `\\[user:${referral.referrer}\\]` },
            code: { $regex: "^REF-" },
            isActive: true,
            // Only deactivate UNUSED coupons; if already used, leave it
            usageCount: 0,
          },
          { $set: { isActive: false } }
        );
      } catch (err) {
        console.error("Referral: failed to deactivate coupon on reversal:", err.message);
      }
    } else {
      await reversePoints(
        referral.referrer,
        referral.rewardAmount,
        orderId,
        `Reversed referral bonus due to order cancellation`
      );
    }
  }

  // Mark as reversed but DO NOT clear isRewarded — the referral is consumed.
  referral.rewardReversedAt = new Date();
  await referral.save();

  return { success: true };
};

module.exports = {
  getReferralConfig,
  applyReferralAtSignup,
  processReferralReward,
  reverseReferralReward,
  generateReferralCouponCode,
};
