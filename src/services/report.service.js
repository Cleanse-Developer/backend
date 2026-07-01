// Assembles the full KPI bundle for the exportable analytics report in one call,
// so the frontend (PDF / XLSX) needs a single request instead of hitting all ten
// KPI endpoints. Mirrors the per-endpoint shapes in kpi.controller.

const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");
const Review = require("../models/Review");
const Referral = require("../models/Referral");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");
const kpi = require("./kpi.service");

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const aov = (revenue, orders) => (orders > 0 ? revenue / orders : 0);
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

const ACTIVE_STATUSES = ["confirmed", "processing", "packed", "pickup_scheduled"];
const IN_TRANSIT_STATUSES = ["shipped", "in_transit", "out_for_delivery"];

async function buildReportBundle(query = {}) {
  const range = kpi.resolveRange(query);
  const { from, to, prevFrom, prevTo, groupBy, spanDays } = range;
  const cfg = await kpi.loadCostConfig();
  const threshold = Math.max(0, Number(query.threshold) || 10);
  const locLimit = Math.min(50, Math.max(1, Number(query.limit) || 10));

  const [
    curTotals,
    prevTotals,
    curProfit,
    prevProfit,
    discounts,
    trendCur,
    trendPrev,
    mix,
    prevMix,
    failure,
    refundCur,
    refundPrev,
    paidCur,
    pendingReturnRequests,
    refundByStatus,
    byState,
    discountAovAgg,
    topCoupons,
    topSpecial,
    newCustomers,
    prevNewCustomers,
    repeatAgg,
    topCustomers,
    loyaltyAgg,
    referralSignups,
    referralPayoutAgg,
    pendingReviewApprovals,
    opsCounts,
    fulfillmentAgg,
    lowStockProducts,
    outOfStockCount,
    invValueAgg,
  ] = await Promise.all([
    kpi.salesTotals(from, to),
    kpi.salesTotals(prevFrom, prevTo),
    kpi.profitBreakdown(from, to, cfg, spanDays),
    kpi.profitBreakdown(prevFrom, prevTo, cfg, spanDays),
    kpi.discountTotals(from, to),
    kpi.salesTrend(from, to, groupBy),
    kpi.salesTrend(prevFrom, prevTo, groupBy),
    kpi.paymentMix(from, to),
    kpi.paymentMix(prevFrom, prevTo),
    kpi.paymentFailureRate(from, to),
    kpi.refundStats(from, to),
    kpi.refundStats(prevFrom, prevTo),
    Order.countDocuments(kpi.paidMatch(from, to)),
    Order.countDocuments({ "returnRequest.status": "requested" }),
    Order.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $unwind: "$payment.refunds" },
      { $group: { _id: "$payment.refunds.status", count: { $sum: 1 }, amount: { $sum: "$payment.refunds.amount" } } },
    ]),
    Order.aggregate([
      { $match: kpi.paidMatch(from, to) },
      { $group: { _id: "$shippingAddress.state", revenue: { $sum: "$pricing.total" }, orderCount: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: locLimit },
      { $project: { _id: 0, state: { $ifNull: ["$_id", "Unknown"] }, revenue: 1, orderCount: 1 } },
    ]),
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
      { $group: { _id: "$discounted", revenue: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
    ]),
    Coupon.find().sort({ usageCount: -1 }).limit(5).select("code usageCount discountType discountValue").lean(),
    SpecialCoupon.find().sort({ usageCount: -1 }).limit(5).select("code title usageCount promotionType").lean(),
    User.countDocuments({ role: "customer", createdAt: { $gte: from, $lt: to } }),
    User.countDocuments({ role: "customer", createdAt: { $gte: prevFrom, $lt: prevTo } }),
    Order.aggregate([
      { $group: { _id: "$user", orders: { $sum: 1 } } },
      { $group: { _id: null, buyers: { $sum: 1 }, repeatBuyers: { $sum: { $cond: [{ $gt: ["$orders", 1] }, 1, 0] } } } },
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
    Promise.all([
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
      Order.countDocuments({ status: "pickup_scheduled" }),
      Order.countDocuments({ status: { $in: IN_TRANSIT_STATUSES } }),
      Order.countDocuments({ status: { $in: ["rto_in_transit", "rto_delivered"] } }),
      Order.countDocuments({ "returnRequest.status": "requested" }),
      Order.countDocuments({ "codConfirmation.status": "awaiting" }),
    ]),
    Order.aggregate([
      { $match: { deliveredAt: { $gte: from, $lt: to, $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ["$deliveredAt", "$createdAt"] } } } },
    ]),
    Product.find({ totalStock: { $lt: threshold }, isActive: true, isDeleted: { $ne: true } })
      .sort({ totalStock: 1 }).limit(20).select("name slug totalStock").lean(),
    Product.countDocuments({ totalStock: { $lte: 0 }, isActive: true, isDeleted: { $ne: true } }),
    Product.aggregate([
      { $match: { isActive: true, isDeleted: { $ne: true } } },
      { $unwind: { path: "$sizes", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: null,
          value: { $sum: { $multiply: [{ $ifNull: ["$sizes.stock", 0] }, { $ifNull: ["$sizes.costPrice", { $ifNull: ["$costPrice", 0] }] }] } },
        },
      },
    ]),
  ]);

  const cod = mix.find((m) => m.method === "cod");
  const prevCod = prevMix.find((m) => m.method === "cod");
  const withD = discountAovAgg.find((r) => r._id === true);
  const withoutD = discountAovAgg.find((r) => r._id === false);
  const buyers = repeatAgg[0]?.buyers || 0;
  const repeatBuyers = repeatAgg[0]?.repeatBuyers || 0;
  const loyalty = loyaltyAgg[0] || { earned: 0, spent: 0 };
  const [pendingOrders, activeOrders, awaitingPickup, inTransit, rtoCount, returnsPending, codAwaitingConfirmation] = opsCounts;

  return {
    range: { from, to, prevFrom, prevTo, groupBy, spanDays },
    summary: {
      totalSales: kpi.compare(curTotals.revenue, prevTotals.revenue),
      orders: kpi.compare(curTotals.orders, prevTotals.orders),
      gmv: kpi.compare(curTotals.gmv, prevTotals.gmv),
      aov: kpi.compare(round(aov(curTotals.revenue, curTotals.orders)), round(aov(prevTotals.revenue, prevTotals.orders))),
      netProfit: kpi.compare(curProfit.netProfit, prevProfit.netProfit),
      netProfitMargin: kpi.compare(curProfit.netProfitMargin, prevProfit.netProfitMargin),
    },
    profit: {
      current: curProfit,
      previous: prevProfit,
      memo: { grossMerchandiseValue: round(curTotals.gmv), discountsGiven: round(discounts.total) },
    },
    salesTrend: { groupBy, current: trendCur, previous: trendPrev },
    payments: {
      mix,
      codSharePct: cod?.sharePct || 0,
      codShare: kpi.compare(cod?.sharePct || 0, prevCod?.sharePct || 0),
      paymentFailure: failure,
    },
    refunds: {
      refundCount: refundCur.refundedOrders,
      refundAmountTotal: round(refundCur.amount),
      refundAmount: kpi.compare(round(refundCur.amount), round(refundPrev.amount)),
      refundRate: pct(refundCur.refundedOrders, paidCur),
      pendingReturnRequests,
      byStatus: refundByStatus.map((s) => ({ status: s._id || "unknown", count: s.count, amount: round(s.amount) })),
    },
    locations: { byState },
    discounts: {
      totalDiscountGiven: round(discounts.total),
      breakdown: {
        coupon: round(discounts.coupon),
        bundle: round(discounts.bundle),
        special: round(discounts.special),
        tier: round(discounts.tier),
        loyalty: round(discounts.loyalty),
      },
      discountAsPctOfGmv: pct(discounts.total, curTotals.gmv),
      aovWithDiscount: round(aov(withD?.revenue || 0, withD?.orders || 0)),
      aovWithoutDiscount: round(aov(withoutD?.revenue || 0, withoutD?.orders || 0)),
      topCoupons,
      topSpecialCoupons: topSpecial,
    },
    customers: {
      newCustomers: kpi.compare(newCustomers, prevNewCustomers),
      buyers,
      repeatBuyers,
      repeatPurchaseRate: pct(repeatBuyers, buyers),
      topCustomersBySpend: topCustomers,
      loyaltyLiability: Math.max(0, (loyalty.earned || 0) - (loyalty.spent || 0)),
      referralSignups,
      referralPayout: round(referralPayoutAgg[0]?.payout || 0),
      pendingReviewApprovals,
    },
    ops: {
      pendingOrders,
      activeOrders,
      awaitingPickup,
      inTransit,
      rtoCount,
      returnsPending,
      codAwaitingConfirmation,
      avgFulfillmentHours: fulfillmentAgg[0]?.avgMs ? round(fulfillmentAgg[0].avgMs / 3600000) : null,
    },
    inventory: {
      lowStockProducts,
      outOfStockCount,
      inventoryValue: round(invValueAgg[0]?.value || 0),
    },
  };
}

module.exports = { buildReportBundle };
