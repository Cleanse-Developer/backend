// Admin KPI dashboard BFF.
// Modular, comparison-aware endpoints mounted at /api/admin/dashboard/kpi.
// All revenue endpoints accept ?dateFrom&dateTo&groupBy and return current +
// previous-period figures via kpi.service `compare()`.

const Order = require("../../models/Order");
const Product = require("../../models/Product");
const User = require("../../models/User");
const Coupon = require("../../models/Coupon");
const SpecialCoupon = require("../../models/SpecialCoupon");
const Review = require("../../models/Review");
const Referral = require("../../models/Referral");
const LoyaltyTransaction = require("../../models/LoyaltyTransaction");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const kpi = require("../../services/kpi.service");
const { buildReportBundle } = require("../../services/report.service");
const { generateReportNarrative } = require("../../ai/report");

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const aov = (revenue, orders) => (orders > 0 ? revenue / orders : 0);

// P&L breakdown now lives in kpi.service (reused by the report). Local alias:
const profitBreakdown = kpi.profitBreakdown;

// GET /api/admin/dashboard/kpi/summary
const getSummary = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo, spanDays } = kpi.resolveRange(req.query);
  const cfg = await kpi.loadCostConfig();

  const [cur, prev, curProfit, prevProfit] = await Promise.all([
    kpi.salesTotals(from, to),
    kpi.salesTotals(prevFrom, prevTo),
    profitBreakdown(from, to, cfg, spanDays),
    profitBreakdown(prevFrom, prevTo, cfg, spanDays),
  ]);

  res.json(
    ApiResponse.ok({
      range: { from, to, prevFrom, prevTo },
      totalSales: kpi.compare(cur.revenue, prev.revenue),
      orders: kpi.compare(cur.orders, prev.orders),
      gmv: kpi.compare(cur.gmv, prev.gmv),
      aov: kpi.compare(
        round(aov(cur.revenue, cur.orders)),
        round(aov(prev.revenue, prev.orders))
      ),
      netProfit: kpi.compare(curProfit.netProfit, prevProfit.netProfit),
      netProfitMargin: kpi.compare(
        curProfit.netProfitMargin,
        prevProfit.netProfitMargin
      ),
    })
  );
});

// GET /api/admin/dashboard/kpi/sales-trend
const getSalesTrend = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo, groupBy } = kpi.resolveRange(req.query);
  const [current, previous] = await Promise.all([
    kpi.salesTrend(from, to, groupBy),
    kpi.salesTrend(prevFrom, prevTo, groupBy),
  ]);
  res.json(
    ApiResponse.ok({ groupBy, range: { from, to, prevFrom, prevTo }, current, previous })
  );
});

// GET /api/admin/dashboard/kpi/profit
const getProfit = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo, spanDays } = kpi.resolveRange(req.query);
  const cfg = await kpi.loadCostConfig();

  const [current, previous, discounts, gmvCur] = await Promise.all([
    profitBreakdown(from, to, cfg, spanDays),
    profitBreakdown(prevFrom, prevTo, cfg, spanDays),
    kpi.discountTotals(from, to),
    kpi.salesTotals(from, to),
  ]);

  res.json(
    ApiResponse.ok({
      range: { from, to, prevFrom, prevTo },
      current,
      previous,
      comparison: {
        revenue: kpi.compare(current.revenue, previous.revenue),
        grossProfit: kpi.compare(current.grossProfit, previous.grossProfit),
        netProfit: kpi.compare(current.netProfit, previous.netProfit),
        netProfitMargin: kpi.compare(
          current.netProfitMargin,
          previous.netProfitMargin
        ),
      },
      // Memo lines (informational, not deducted from net profit above).
      memo: {
        grossMerchandiseValue: round(gmvCur.gmv),
        discountsGiven: round(discounts.total),
      },
    })
  );
});

const ACTIVE_STATUSES = ["confirmed", "processing", "packed", "pickup_scheduled"];
const IN_TRANSIT_STATUSES = ["shipped", "in_transit", "out_for_delivery"];

// GET /api/admin/dashboard/kpi/orders-ops
const getOrdersOps = asyncHandler(async (req, res) => {
  const { from, to } = kpi.resolveRange(req.query);

  const [
    pendingOrders,
    activeOrders,
    awaitingPickup,
    inTransit,
    rtoCount,
    returnsPending,
    codAwaitingConfirmation,
    fulfillmentAgg,
  ] = await Promise.all([
    Order.countDocuments({ status: "pending" }),
    Order.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
    Order.countDocuments({ status: "pickup_scheduled" }),
    Order.countDocuments({ status: { $in: IN_TRANSIT_STATUSES } }),
    Order.countDocuments({ status: { $in: ["rto_in_transit", "rto_delivered"] } }),
    Order.countDocuments({ "returnRequest.status": "requested" }),
    Order.countDocuments({ "codConfirmation.status": "awaiting" }),
    Order.aggregate([
      {
        $match: {
          deliveredAt: { $gte: from, $lt: to, $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          avgMs: { $avg: { $subtract: ["$deliveredAt", "$createdAt"] } },
        },
      },
    ]),
  ]);

  res.json(
    ApiResponse.ok({
      pendingOrders,
      activeOrders,
      awaitingPickup,
      inTransit,
      rtoCount,
      returnsPending,
      codAwaitingConfirmation,
      avgFulfillmentHours: fulfillmentAgg[0]?.avgMs
        ? round(fulfillmentAgg[0].avgMs / 3600000)
        : null,
    })
  );
});

// GET /api/admin/dashboard/kpi/payments
const getPayments = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo } = kpi.resolveRange(req.query);
  const [mix, prevMix, failure] = await Promise.all([
    kpi.paymentMix(from, to),
    kpi.paymentMix(prevFrom, prevTo),
    kpi.paymentFailureRate(from, to),
  ]);

  const cod = mix.find((m) => m.method === "cod");
  const prevCod = prevMix.find((m) => m.method === "cod");

  res.json(
    ApiResponse.ok({
      range: { from, to, prevFrom, prevTo },
      mix,
      codSharePct: cod?.sharePct || 0,
      codShare: kpi.compare(cod?.sharePct || 0, prevCod?.sharePct || 0),
      paymentFailure: failure,
    })
  );
});

// GET /api/admin/dashboard/kpi/refunds
const getRefunds = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo } = kpi.resolveRange(req.query);

  const [cur, prev, paidCur, pendingReturnRequests, byStatus] =
    await Promise.all([
      kpi.refundStats(from, to),
      kpi.refundStats(prevFrom, prevTo),
      Order.countDocuments(kpi.paidMatch(from, to)),
      Order.countDocuments({ "returnRequest.status": "requested" }),
      Order.aggregate([
        { $match: { createdAt: { $gte: from, $lt: to } } },
        { $unwind: "$payment.refunds" },
        { $group: { _id: "$payment.refunds.status", count: { $sum: 1 }, amount: { $sum: "$payment.refunds.amount" } } },
      ]),
    ]);

  const refundRate =
    paidCur > 0 ? Math.round((cur.refundedOrders / paidCur) * 1000) / 10 : 0;

  res.json(
    ApiResponse.ok({
      range: { from, to, prevFrom, prevTo },
      refundCount: cur.refundedOrders,
      refundAmountTotal: round(cur.amount),
      refundAmount: kpi.compare(round(cur.amount), round(prev.amount)),
      refundRate,
      pendingReturnRequests,
      byStatus: byStatus.map((s) => ({
        status: s._id || "unknown",
        count: s.count,
        amount: round(s.amount),
      })),
    })
  );
});

// GET /api/admin/dashboard/kpi/locations
const getLocations = asyncHandler(async (req, res) => {
  const { from, to } = kpi.resolveRange(req.query);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  const byState = await Order.aggregate([
    { $match: kpi.paidMatch(from, to) },
    {
      $group: {
        _id: "$shippingAddress.state",
        revenue: { $sum: "$pricing.total" },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    { $project: { _id: 0, state: { $ifNull: ["$_id", "Unknown"] }, revenue: 1, orderCount: 1 } },
  ]);

  res.json(ApiResponse.ok({ range: { from, to }, byState }));
});

// GET /api/admin/dashboard/kpi/discounts
const getDiscounts = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo } = kpi.resolveRange(req.query);

  const [discounts, prevDiscounts, totals, aovAgg, topCoupons, topSpecial] =
    await Promise.all([
      kpi.discountTotals(from, to),
      kpi.discountTotals(prevFrom, prevTo),
      kpi.salesTotals(from, to),
      Order.aggregate([
        { $match: kpi.paidMatch(from, to) },
        {
          $addFields: {
            discounted: {
              $gt: [
                {
                  $add: [
                    "$pricing.couponDiscount",
                    "$pricing.bundleDiscountTotal",
                    "$pricing.specialCouponDiscountTotal",
                    "$pricing.tierDiscount",
                    "$pricing.loyaltyDiscount",
                  ],
                },
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: "$discounted",
            revenue: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
      ]),
      Coupon.find().sort({ usageCount: -1 }).limit(5).select("code usageCount discountType discountValue").lean(),
      SpecialCoupon.find().sort({ usageCount: -1 }).limit(5).select("code title usageCount promotionType").lean(),
    ]);

  const withD = aovAgg.find((r) => r._id === true);
  const withoutD = aovAgg.find((r) => r._id === false);

  res.json(
    ApiResponse.ok({
      range: { from, to, prevFrom, prevTo },
      totalDiscountGiven: round(discounts.total),
      breakdown: {
        coupon: round(discounts.coupon),
        bundle: round(discounts.bundle),
        special: round(discounts.special),
        tier: round(discounts.tier),
        loyalty: round(discounts.loyalty),
      },
      discountGiven: kpi.compare(round(discounts.total), round(prevDiscounts.total)),
      discountAsPctOfGmv:
        totals.gmv > 0 ? Math.round((discounts.total / totals.gmv) * 1000) / 10 : 0,
      aovWithDiscount: round(aov(withD?.revenue || 0, withD?.orders || 0)),
      aovWithoutDiscount: round(aov(withoutD?.revenue || 0, withoutD?.orders || 0)),
      topCoupons,
      topSpecialCoupons: topSpecial,
    })
  );
});

// GET /api/admin/dashboard/kpi/customers
const getCustomers = asyncHandler(async (req, res) => {
  const { from, to, prevFrom, prevTo } = kpi.resolveRange(req.query);

  const [
    newCustomers,
    prevNewCustomers,
    repeatAgg,
    topCustomers,
    loyaltyAgg,
    referralSignups,
    referralPayoutAgg,
    pendingReviewApprovals,
  ] = await Promise.all([
    User.countDocuments({ role: "customer", createdAt: { $gte: from, $lt: to } }),
    User.countDocuments({ role: "customer", createdAt: { $gte: prevFrom, $lt: prevTo } }),
    // Repeat-purchase: of customers who have ordered, how many have >1 order.
    Order.aggregate([
      { $group: { _id: "$user", orders: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          buyers: { $sum: 1 },
          repeatBuyers: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { "payment.status": "paid" } },
      { $group: { _id: "$user", totalSpend: { $sum: "$pricing.total" }, orderCount: { $sum: 1 } } },
      { $sort: { totalSpend: -1 } },
      { $limit: 5 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $project: { _id: 0, userId: "$user._id", fullName: "$user.fullName", email: "$user.email", totalSpend: 1, orderCount: 1 } },
    ]),
    // Loyalty liability: net outstanding points (earned + bonus − redeemed − expired).
    LoyaltyTransaction.aggregate([
      {
        $group: {
          _id: null,
          earned: { $sum: { $cond: [{ $in: ["$type", ["earned", "referral_bonus", "manual_adjustment"]] }, "$points", 0] } },
          spent: { $sum: { $cond: [{ $in: ["$type", ["redeemed", "expired", "reversed"]] }, "$points", 0] } },
        },
      },
    ]),
    Referral.countDocuments({ createdAt: { $gte: from, $lt: to } }),
    Referral.aggregate([
      { $match: { isRewarded: true, rewardedAt: { $gte: from, $lt: to } } },
      { $group: { _id: null, payout: { $sum: "$rewardAmount" } } },
    ]),
    Review.countDocuments({ isApproved: false }),
  ]);

  const buyers = repeatAgg[0]?.buyers || 0;
  const repeatBuyers = repeatAgg[0]?.repeatBuyers || 0;
  const loyalty = loyaltyAgg[0] || { earned: 0, spent: 0 };

  res.json(
    ApiResponse.ok({
      range: { from, to, prevFrom, prevTo },
      newCustomers: kpi.compare(newCustomers, prevNewCustomers),
      buyers,
      repeatBuyers,
      repeatPurchaseRate:
        buyers > 0 ? Math.round((repeatBuyers / buyers) * 1000) / 10 : 0,
      topCustomersBySpend: topCustomers,
      loyaltyLiability: Math.max(0, (loyalty.earned || 0) - (loyalty.spent || 0)),
      referralSignups,
      referralPayout: round(referralPayoutAgg[0]?.payout || 0),
      pendingReviewApprovals,
    })
  );
});

// GET /api/admin/dashboard/kpi/inventory
const getInventory = asyncHandler(async (req, res) => {
  const threshold = Math.max(0, Number(req.query.threshold) || 10);

  const [lowStockProducts, outOfStockCount, valueAgg] = await Promise.all([
    Product.find({ totalStock: { $lt: threshold }, isActive: true, isDeleted: { $ne: true } })
      .sort({ totalStock: 1 })
      .limit(20)
      .select("name slug totalStock images")
      .lean(),
    Product.countDocuments({ totalStock: { $lte: 0 }, isActive: true, isDeleted: { $ne: true } }),
    Product.aggregate([
      { $match: { isActive: true, isDeleted: { $ne: true } } },
      { $unwind: { path: "$sizes", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: null,
          value: {
            $sum: {
              $multiply: [
                { $ifNull: ["$sizes.stock", 0] },
                { $ifNull: ["$sizes.costPrice", { $ifNull: ["$costPrice", 0] }] },
              ],
            },
          },
        },
      },
    ]),
  ]);

  res.json(
    ApiResponse.ok({
      threshold,
      lowStockProducts,
      lowStockCount: lowStockProducts.length,
      outOfStockCount,
      inventoryValue: round(valueAgg[0]?.value || 0),
    })
  );
});

// GET /api/admin/dashboard/kpi/quick-actions
// Cheap badge counts for the top quick-action buttons.
const getQuickActions = asyncHandler(async (req, res) => {
  const threshold = Math.max(0, Number(req.query.threshold) || 10);
  const [pendingOrders, returnsToAction, reviewsToApprove, lowStockCount, codToConfirm] =
    await Promise.all([
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ "returnRequest.status": "requested" }),
      Review.countDocuments({ isApproved: false }),
      Product.countDocuments({ totalStock: { $lt: threshold }, isActive: true, isDeleted: { $ne: true } }),
      Order.countDocuments({ "codConfirmation.status": "awaiting" }),
    ]);

  res.json(
    ApiResponse.ok({ pendingOrders, returnsToAction, reviewsToApprove, lowStockCount, codToConfirm })
  );
});

// GET /api/admin/dashboard/kpi/report
// Full KPI bundle + Gemini-written narrative for the exportable PDF/XLSX report.
const getReport = asyncHandler(async (req, res) => {
  const bundle = await buildReportBundle(req.query);
  const narrative = await generateReportNarrative(bundle);
  res.json(ApiResponse.ok({ ...bundle, narrative }));
});

module.exports = {
  getSummary,
  getSalesTrend,
  getProfit,
  getOrdersOps,
  getPayments,
  getRefunds,
  getLocations,
  getDiscounts,
  getCustomers,
  getInventory,
  getQuickActions,
  getReport,
};
