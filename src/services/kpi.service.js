// KPI / analytics service for the admin dashboard BFF.
// Pure helpers (resolveRange, compare) are dependency-free and unit-tested.
// Aggregation helpers run against Mongo and are composed by kpi.controller.

const Order = require("../models/Order");
const PaymentSession = require("../models/PaymentSession");
const Settings = require("../models/Settings");

const COST_CONFIG_KEY = "dashboard_cost_config";

const DEFAULT_COST_CONFIG = {
  packagingCostPerOrder: 0, // flat ₹ per order
  warehouseMonthlyCost: 0, // ₹/month, prorated across the period
  shippingCostMode: "actual", // "actual" → use order.pricing.shippingCost; "flat" → flatShippingPerOrder
  flatShippingPerOrder: 0,
  gatewayFeePercent: { razorpay: 2, upi: 0, cod: 0 },
  defaultCogsPercent: 40, // fallback COGS (% of line revenue) when product.costPrice is missing
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Resolve a query (?dateFrom&dateTo&groupBy) into the current window, the
// equal-length window immediately preceding it (for period-over-period deltas),
// and a sensible groupBy bucket. Defaults to the current calendar month.
// Windows are half-open: [from, to) and [prevFrom, prevTo) with prevTo === from.
function resolveRange(query = {}) {
  const now = new Date();
  const to = query.dateTo ? new Date(query.dateTo) : now;
  const from = query.dateFrom
    ? new Date(query.dateFrom)
    : new Date(to.getFullYear(), to.getMonth(), 1);

  const span = Math.max(0, to.getTime() - from.getTime());
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - span);

  const days = span / DAY_MS;
  let groupBy = query.groupBy;
  if (!["day", "week", "month"].includes(groupBy)) {
    groupBy = days <= 31 ? "day" : days <= 180 ? "week" : "month";
  }

  return { from, to, prevFrom, prevTo, groupBy, spanDays: days };
}

// Build a { value, previous, deltaPct, direction } comparison object.
// deltaPct is null when there is no comparable base (previous === 0).
function compare(value, previous) {
  const v = Number(value) || 0;
  const p = Number(previous) || 0;
  let deltaPct = null;
  if (p !== 0) deltaPct = Math.round(((v - p) / Math.abs(p)) * 1000) / 10;
  const direction = v > p ? "up" : v < p ? "down" : "flat";
  return { value: v, previous: p, deltaPct, direction };
}

// Standard match for realised revenue (paid orders within a window).
function paidMatch(from, to) {
  return { "payment.status": "paid", createdAt: { $gte: from, $lt: to } };
}

// Merge stored cost config over defaults (deep-merge gatewayFeePercent).
async function loadCostConfig() {
  const doc = await Settings.findOne({ key: COST_CONFIG_KEY }).lean();
  const v = doc?.value || {};
  return {
    ...DEFAULT_COST_CONFIG,
    ...v,
    gatewayFeePercent: {
      ...DEFAULT_COST_CONFIG.gatewayFeePercent,
      ...(v.gatewayFeePercent || {}),
    },
  };
}

const $dateFormatFor = (groupBy) => {
  if (groupBy === "week") return "%Y-W%V";
  if (groupBy === "month") return "%Y-%m";
  return "%Y-%m-%d";
};

// ── Aggregation helpers (each scoped to a [from, to) window) ──────────────────

// Realised revenue (sum of pricing.total), order count, and gross merchandise
// value (sum of pricing.subtotal, pre-discount) for paid orders.
async function salesTotals(from, to) {
  const [r] = await Order.aggregate([
    { $match: paidMatch(from, to) },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$pricing.total" },
        gmv: { $sum: "$pricing.subtotal" },
        orders: { $sum: 1 },
      },
    },
  ]);
  return { revenue: r?.revenue || 0, gmv: r?.gmv || 0, orders: r?.orders || 0 };
}

// COGS for paid orders: join each line to its Product, prefer the matching
// size.costPrice, fall back to product.costPrice, then to defaultCogsPercent.
async function computeCogs(from, to, cfg) {
  const cogsFraction = (Number(cfg.defaultCogsPercent) || 0) / 100;
  const [r] = await Order.aggregate([
    { $match: paidMatch(from, to) },
    { $unwind: "$items" },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "prod",
      },
    },
    { $unwind: { path: "$prod", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        lineRevenue: { $multiply: ["$items.price", "$items.quantity"] },
        matchedSize: {
          $first: {
            $filter: {
              input: { $ifNull: ["$prod.sizes", []] },
              as: "s",
              cond: { $eq: ["$$s.label", "$items.selectedSize"] },
            },
          },
        },
      },
    },
    {
      $addFields: {
        unitCost: {
          $ifNull: ["$matchedSize.costPrice", "$prod.costPrice"],
        },
      },
    },
    {
      $addFields: {
        lineCost: {
          $cond: [
            { $ne: ["$unitCost", null] },
            { $multiply: ["$unitCost", "$items.quantity"] },
            { $multiply: ["$lineRevenue", cogsFraction] },
          ],
        },
      },
    },
    { $group: { _id: null, cogs: { $sum: "$lineCost" } } },
  ]);
  return r?.cogs || 0;
}

// Sum of every discount type across paid orders in the window.
async function discountTotals(from, to) {
  const [r] = await Order.aggregate([
    { $match: paidMatch(from, to) },
    {
      $group: {
        _id: null,
        coupon: { $sum: "$pricing.couponDiscount" },
        bundle: { $sum: "$pricing.bundleDiscountTotal" },
        special: { $sum: "$pricing.specialCouponDiscountTotal" },
        tier: { $sum: "$pricing.tierDiscount" },
        loyalty: { $sum: "$pricing.loyaltyDiscount" },
      },
    },
  ]);
  const d = r || {};
  const coupon = d.coupon || 0;
  const bundle = d.bundle || 0;
  const special = d.special || 0;
  const tier = d.tier || 0;
  const loyalty = d.loyalty || 0;
  return {
    coupon,
    bundle,
    special,
    tier,
    loyalty,
    total: coupon + bundle + special + tier + loyalty,
  };
}

// Realised revenue + order count + share by payment method (paid orders).
async function paymentMix(from, to) {
  const rows = await Order.aggregate([
    { $match: paidMatch(from, to) },
    {
      $group: {
        _id: "$payment.method",
        count: { $sum: 1 },
        revenue: { $sum: "$pricing.total" },
      },
    },
    { $sort: { revenue: -1 } },
  ]);
  const totalRevenue = rows.reduce((s, x) => s + (x.revenue || 0), 0);
  return rows.map((x) => ({
    method: x._id || "unknown",
    count: x.count,
    revenue: x.revenue || 0,
    sharePct:
      totalRevenue > 0
        ? Math.round(((x.revenue || 0) / totalRevenue) * 1000) / 10
        : 0,
  }));
}

// Payment-session failure rate (failed + expired) over sessions created in window.
async function paymentFailureRate(from, to) {
  const rows = await PaymentSession.aggregate([
    { $match: { createdAt: { $gte: from, $lt: to } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  let total = 0;
  let failed = 0;
  for (const r of rows) {
    total += r.count;
    if (r._id === "failed" || r._id === "expired") failed += r.count;
  }
  return {
    total,
    failed,
    ratePct: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
  };
}

// Aligned time series of revenue + orderCount per bucket for a single window.
async function salesTrend(from, to, groupBy) {
  const fmt = $dateFormatFor(groupBy);
  return Order.aggregate([
    { $match: paidMatch(from, to) },
    {
      $group: {
        _id: { $dateToString: { format: fmt, date: "$createdAt" } },
        revenue: { $sum: "$pricing.total" },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: "$_id", revenue: 1, orderCount: 1 } },
  ]);
}

// Refunded amount across orders touched in the window. Sums refunds[].amount
// for refund entries whose status is "processed".
async function refundStats(from, to) {
  const [r] = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: from, $lt: to },
        "payment.status": { $in: ["refunded", "partially_refunded"] },
      },
    },
    {
      $group: {
        _id: null,
        refundedOrders: { $sum: 1 },
        amount: {
          $sum: {
            $reduce: {
              input: { $ifNull: ["$payment.refunds", []] },
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  {
                    $cond: [
                      { $eq: ["$$this.status", "processed"] },
                      { $ifNull: ["$$this.amount", 0] },
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
  ]);
  return { refundedOrders: r?.refundedOrders || 0, amount: r?.amount || 0 };
}

module.exports = {
  COST_CONFIG_KEY,
  DEFAULT_COST_CONFIG,
  resolveRange,
  compare,
  paidMatch,
  loadCostConfig,
  salesTotals,
  computeCogs,
  discountTotals,
  paymentMix,
  paymentFailureRate,
  salesTrend,
  refundStats,
};
