const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const Settings = require("../models/Settings");
const Order = require("../models/Order");

const DEFAULT_CONFIG = {
  enabled: true,
  earnRatePerRupee: 0.1,
  redeemRatePerPoint: 1,
  minRedemptionPoints: 100,
  maxPercentOfOrder: 50,
  expiryDays: 365,
  showInProfile: true,
};

/**
 * Load loyalty config from Settings collection.
 * Returns defaults if not configured.
 */
const getLoyaltyConfig = async () => {
  const doc = await Settings.findOne({ key: "loyalty_config" }).lean();
  if (!doc?.value) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...doc.value };
};

/**
 * Award loyalty points to a user and record the transaction.
 * @param {string} userId
 * @param {number} points
 * @param {string} orderId
 * @param {string} description
 * @param {string} type - "earned" | "referral_bonus" | "manual_adjustment"
 */
const awardPoints = async (
  userId,
  points,
  orderId,
  description,
  type = "earned"
) => {
  if (points <= 0) return null;

  await User.findByIdAndUpdate(userId, {
    $inc: { loyaltyPoints: points },
  });

  return LoyaltyTransaction.create({
    user: userId,
    type,
    points,
    order: orderId || undefined,
    description: description || `Earned ${points} points`,
  });
};

/**
 * Redeem loyalty points atomically. Returns null if user has insufficient balance.
 * Caller MUST handle null return as a failure.
 */
const redeemPoints = async (userId, points, orderId, description) => {
  if (points <= 0) return null;

  // Atomic guard: only decrement if user has enough points
  const updated = await User.findOneAndUpdate(
    { _id: userId, loyaltyPoints: { $gte: points } },
    { $inc: { loyaltyPoints: -points } },
    { new: true }
  );

  if (!updated) return null;

  try {
    return await LoyaltyTransaction.create({
      user: userId,
      type: "redeemed",
      points: -points,
      order: orderId || undefined,
      description: description || `Redeemed ${points} points`,
    });
  } catch (err) {
    // Compensate: refund points if transaction record creation fails
    await User.findByIdAndUpdate(userId, { $inc: { loyaltyPoints: points } });
    throw err;
  }
};

/**
 * Reverse previously-awarded points from a cancelled/refunded order.
 * Different from redeem: this is a clawback of points we granted.
 *
 * Floors the balance at zero: a reversal must never push the balance negative
 * (e.g. the awarded points were already redeemed on another order before this one
 * was cancelled). The clamp is atomic via an update pipeline; the pre-update doc
 * is returned so the ledger records the amount ACTUALLY reversed.
 */
const reversePoints = async (userId, points, orderId, description) => {
  if (points <= 0) return null;

  const before = await User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          loyaltyPoints: {
            $max: [0, { $subtract: [{ $ifNull: ["$loyaltyPoints", 0] }, points] }],
          },
        },
      },
    ],
    { new: false }
  );
  if (!before) return null;

  const actual = Math.min(points, Math.max(0, before.loyaltyPoints || 0));
  if (actual <= 0) return null;

  return LoyaltyTransaction.create({
    user: userId,
    type: "reversed",
    points: -actual,
    order: orderId || undefined,
    description: description || `Reversed ${actual} points`,
  });
};

/**
 * Award an order's earned points to the buyer AND record on the order how many
 * were actually credited (order.loyaltyPointsAwarded). Award first, then record —
 * so a recorded amount always implies the points were really granted. Use this at
 * every order-earn site instead of calling awardPoints directly, so the later
 * cancel/refund reverses the credited amount, not the creation-time estimate.
 */
const awardOrderPoints = async (order) => {
  const amount = order?.loyaltyPointsEarned || 0;
  if (amount <= 0 || !order?.user) return null;
  if (order.loyaltyPointsAwarded > 0) return null; // already awarded — don't double

  const txn = await awardPoints(
    order.user,
    amount,
    order._id,
    `Earned ${amount} points from order ${order.orderId}`
  );
  await Order.updateOne(
    { _id: order._id },
    { $set: { loyaltyPointsAwarded: amount } }
  );
  order.loyaltyPointsAwarded = amount; // keep in-memory doc consistent
  return txn;
};

/**
 * Reverse the points ACTUALLY credited for an order (order.loyaltyPointsAwarded)
 * on cancel/refund. Idempotent: zeroes the recorded amount so a second
 * cancel/refund is a no-op. Reverses nothing when the points were never credited
 * (order cancelled before payment / COD approval) — the source of the negative
 * balances this replaces.
 */
const reverseOrderPoints = async (order, verb = "cancelled") => {
  const amount = order?.loyaltyPointsAwarded || 0;
  if (amount <= 0 || !order?.user) return null;

  const txn = await reversePoints(
    order.user,
    amount,
    order._id,
    `Reversed ${amount} points from ${verb} order ${order.orderId}`
  );
  await Order.updateOne(
    { _id: order._id },
    { $set: { loyaltyPointsAwarded: 0 } }
  );
  order.loyaltyPointsAwarded = 0;
  return txn;
};

/**
 * Manually adjust a user's points (admin action). Can be positive or negative.
 */
const adjustPoints = async (userId, delta, description, adminUserId) => {
  if (delta === 0) return null;

  const user = await User.findOneAndUpdate(
    delta < 0
      ? { _id: userId, loyaltyPoints: { $gte: Math.abs(delta) } }
      : { _id: userId },
    { $inc: { loyaltyPoints: delta } },
    { new: true }
  );

  if (!user) return null;

  return LoyaltyTransaction.create({
    user: userId,
    type: "manual_adjustment",
    points: delta,
    description:
      description ||
      `Manual adjustment of ${delta > 0 ? "+" : ""}${delta} points by admin`,
  });
};

/**
 * Calculate the maximum number of points a user can redeem on an order
 * given their balance, the order subtotal, and the loyalty config.
 *
 * Returns { maxPoints, maxDiscount } where both respect:
 *  - user balance
 *  - minRedemptionPoints (returns 0 if balance < min)
 *  - maxPercentOfOrder cap on subtotal
 */
const calculateMaxRedeemable = (userBalance, orderSubtotal, config) => {
  if (!config || !config.enabled) {
    return { maxPoints: 0, maxDiscount: 0 };
  }
  if (userBalance < config.minRedemptionPoints) {
    return { maxPoints: 0, maxDiscount: 0 };
  }
  if (orderSubtotal <= 0 || config.redeemRatePerPoint <= 0) {
    return { maxPoints: 0, maxDiscount: 0 };
  }

  const maxDiscountFromPercent = Math.floor(
    (orderSubtotal * config.maxPercentOfOrder) / 100
  );
  const maxPointsFromPercent = Math.floor(
    maxDiscountFromPercent / config.redeemRatePerPoint
  );

  const maxPoints = Math.max(0, Math.min(userBalance, maxPointsFromPercent));
  // Re-floor for safety; min ensures we don't allow a non-redeemable amount
  const maxDiscount = Math.floor(maxPoints * config.redeemRatePerPoint);

  // If max is below min, the user can't redeem at all on this order
  if (maxPoints < config.minRedemptionPoints) {
    return { maxPoints: 0, maxDiscount: 0 };
  }

  return { maxPoints, maxDiscount };
};

/**
 * Validate a requested redemption against user balance and config.
 * Returns { valid, discount, message }.
 */
const validateRedemption = async (userId, points, orderSubtotal) => {
  const config = await getLoyaltyConfig();
  if (!config.enabled) {
    return { valid: false, discount: 0, message: "Loyalty program is disabled" };
  }
  if (!points || points <= 0) {
    return { valid: false, discount: 0, message: "Enter points to redeem" };
  }
  if (points < config.minRedemptionPoints) {
    return {
      valid: false,
      discount: 0,
      message: `Minimum redemption is ${config.minRedemptionPoints} points`,
    };
  }

  const user = await User.findById(userId).select("loyaltyPoints").lean();
  if (!user) {
    return { valid: false, discount: 0, message: "User not found" };
  }
  if (user.loyaltyPoints < points) {
    return {
      valid: false,
      discount: 0,
      message: `Insufficient balance (you have ${user.loyaltyPoints} points)`,
    };
  }

  const { maxPoints, maxDiscount } = calculateMaxRedeemable(
    user.loyaltyPoints,
    orderSubtotal,
    config
  );

  if (points > maxPoints) {
    return {
      valid: false,
      discount: 0,
      message: `You can redeem at most ${maxPoints} points on this order`,
    };
  }

  return {
    valid: true,
    discount: points * config.redeemRatePerPoint,
    message: null,
    maxPoints,
    maxDiscount,
  };
};

/**
 * Expire points older than expiryDays. Called by daily cron job.
 * Strategy: for each user with points, find their oldest non-expired
 * positive transactions and expire them up to the user's current balance.
 * This is a FIFO model: oldest earned points expire first.
 */
const expirePoints = async () => {
  const config = await getLoyaltyConfig();
  if (!config.enabled || !config.expiryDays || config.expiryDays <= 0) {
    return { processed: 0, expired: 0 };
  }

  const cutoffDate = new Date(
    Date.now() - config.expiryDays * 24 * 60 * 60 * 1000
  );

  // Find users with a positive balance who have earned points before cutoff
  const candidates = await LoyaltyTransaction.aggregate([
    {
      $match: {
        type: { $in: ["earned", "referral_bonus", "manual_adjustment"] },
        points: { $gt: 0 },
        createdAt: { $lt: cutoffDate },
      },
    },
    {
      $group: {
        _id: "$user",
        expiringPoints: { $sum: "$points" },
      },
    },
  ]);

  let processed = 0;
  let expired = 0;

  for (const c of candidates) {
    const user = await User.findById(c._id).select("loyaltyPoints");
    if (!user || user.loyaltyPoints <= 0) continue;

    // Already counted "spent" amount: subtract redeemed/reversed/expired
    const spent = await LoyaltyTransaction.aggregate([
      {
        $match: {
          user: user._id,
          type: { $in: ["redeemed", "reversed", "expired"] },
          createdAt: { $lt: cutoffDate },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$points" }, // negative numbers
        },
      },
    ]);

    const spentAmount = Math.abs(spent[0]?.total || 0);
    const eligibleToExpire = Math.max(0, c.expiringPoints - spentAmount);
    const toExpire = Math.min(eligibleToExpire, user.loyaltyPoints);

    if (toExpire > 0) {
      await User.findByIdAndUpdate(user._id, {
        $inc: { loyaltyPoints: -toExpire },
      });
      await LoyaltyTransaction.create({
        user: user._id,
        type: "expired",
        points: -toExpire,
        description: `Expired ${toExpire} points (older than ${config.expiryDays} days)`,
      });
      expired += toExpire;
    }
    processed += 1;
  }

  return { processed, expired };
};

module.exports = {
  awardPoints,
  awardOrderPoints,
  redeemPoints,
  reversePoints,
  reverseOrderPoints,
  adjustPoints,
  calculateMaxRedeemable,
  validateRedemption,
  expirePoints,
  getLoyaltyConfig,
};
