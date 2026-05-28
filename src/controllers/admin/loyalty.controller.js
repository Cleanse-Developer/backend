const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const { paginationMeta } = require("../../utils/pagination");
const User = require("../../models/User");
const LoyaltyTransaction = require("../../models/LoyaltyTransaction");
const { adjustPoints } = require("../../services/loyalty.service");

// GET /api/admin/loyalty/users
// Paginated list of users with their loyalty balance
const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const search = (req.query.search || "").trim();
  const minPoints = Number(req.query.minPoints) || 0;

  const filter = { role: "customer" };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { fullName: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ];
  }
  if (minPoints > 0) {
    filter.loyaltyPoints = { $gte: minPoints };
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("fullName email phone loyaltyPoints createdAt")
      .sort({ loyaltyPoints: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      users,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// GET /api/admin/loyalty/users/:userId/transactions
const getUserTransactions = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const user = await User.findById(userId)
    .select("fullName email phone loyaltyPoints")
    .lean();
  if (!user) throw ApiError.notFound("User not found");

  const [transactions, total] = await Promise.all([
    LoyaltyTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("order", "orderId")
      .lean(),
    LoyaltyTransaction.countDocuments({ user: userId }),
  ]);

  res.json(
    ApiResponse.ok({
      user,
      transactions,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// POST /api/admin/loyalty/users/:userId/adjust
// Body: { points (positive or negative), reason }
const adjustUserPoints = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { points, reason } = req.body;

  const delta = Number(points);
  if (!Number.isFinite(delta) || delta === 0) {
    throw ApiError.badRequest("points must be a non-zero number");
  }
  if (!reason || !reason.trim()) {
    throw ApiError.badRequest("reason is required");
  }

  const transaction = await adjustPoints(
    userId,
    delta,
    `${reason.trim()} (by admin ${req.user.email || req.user._id})`
  );

  if (!transaction) {
    throw ApiError.conflict(
      "Adjustment failed (user not found or insufficient balance for negative adjustment)"
    );
  }

  const user = await User.findById(userId).select("fullName email loyaltyPoints").lean();

  res.json(ApiResponse.ok({ user, transaction }, "Points adjusted"));
});

// GET /api/admin/loyalty/stats
const getStats = asyncHandler(async (req, res) => {
  const [totals, byType] = await Promise.all([
    User.aggregate([
      { $match: { role: "customer" } },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          usersWithPoints: {
            $sum: { $cond: [{ $gt: ["$loyaltyPoints", 0] }, 1, 0] },
          },
          totalPointsOutstanding: { $sum: "$loyaltyPoints" },
          maxBalance: { $max: "$loyaltyPoints" },
        },
      },
    ]),
    LoyaltyTransaction.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          pointsTotal: { $sum: "$points" },
        },
      },
    ]),
  ]);

  res.json(
    ApiResponse.ok({
      totals: totals[0] || {
        totalUsers: 0,
        usersWithPoints: 0,
        totalPointsOutstanding: 0,
        maxBalance: 0,
      },
      byType,
    })
  );
});

module.exports = {
  listUsers,
  getUserTransactions,
  adjustUserPoints,
  getStats,
};
