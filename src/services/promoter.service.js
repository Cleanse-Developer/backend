const crypto = require("crypto");
const Settings = require("../models/Settings");
const Promoter = require("../models/Promoter");
const PromoterLink = require("../models/PromoterLink");
const CommissionLedger = require("../models/CommissionLedger");
const Settlement = require("../models/Settlement");
const Coupon = require("../models/Coupon");
const SpecialCoupon = require("../models/SpecialCoupon");

const DEFAULT_PROMOTER_CONFIG = {
  enabled: true,
  defaultCommissionType: "percentage", // "percentage" | "fixed_per_order"
  defaultCommissionRate: 10, // percent, or flat ₹ when fixed
  commissionBasis: "net_merchandise", // subtotal - all discounts (excl. shipping/giftwrap/loyalty)
  autoApproveAfterDays: 7, // pending -> approved this long after delivery
  attributionWindowDays: 30, // last-click cookie lifetime
  clickDedupWindowMinutes: 60, // same visitor+slug collapses to one unique
};

const getPromoterConfig = async () => {
  const doc = await Settings.findOne({ key: "promoter_config" }).lean();
  if (!doc?.value) return { ...DEFAULT_PROMOTER_CONFIG };
  return { ...DEFAULT_PROMOTER_CONFIG, ...doc.value };
};

// ---------------------------------------------------------------------------
// Code / slug generation
// ---------------------------------------------------------------------------

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const randomSuffix = (length) => {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return s;
};

// Unique admin handle for a promoter (e.g. "PR-A7F2C9"). NOT a customer coupon.
const generatePromoterCode = async (base) => {
  const seed = (base || "PR")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  for (let i = 0; i < 20; i++) {
    const code = `${seed || "PR"}-${randomSuffix(i < 10 ? 4 : 6)}`;
    const exists = await Promoter.exists({ code });
    if (!exists) return code;
  }
  throw new Error("Failed to generate a unique promoter code after 20 attempts");
};

// Unique lowercase slug for a tracking link.
const generateLinkSlug = async (base) => {
  const seed = (base || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  for (let i = 0; i < 20; i++) {
    const slug = seed
      ? `${seed}-${randomSuffix(4).toLowerCase()}`
      : randomSuffix(8).toLowerCase();
    const exists = await PromoterLink.exists({ slug });
    if (!exists) return slug;
  }
  throw new Error("Failed to generate a unique link slug after 20 attempts");
};

// Human-readable settlement id, e.g. "STL-2026-0001".
const generateSettlementId = async () => {
  const year = new Date().getFullYear();
  const prefix = `STL-${year}-`;
  const latest = await Settlement.findOne({ settlementId: { $regex: `^${prefix}` } })
    .sort({ settlementId: -1 })
    .select("settlementId")
    .lean();
  let nextSeq = 1;
  if (latest) {
    const lastSeq = parseInt(latest.settlementId.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Attribution + commission math
// ---------------------------------------------------------------------------

// Resolve which promoter owns a coupon/special-coupon code (uppercased).
const resolvePromoterByCode = async (code) => {
  if (!code) return null;
  const upper = String(code).toUpperCase();
  const coupon = await Coupon.findOne({ code: upper }).select("promoter").lean();
  if (coupon?.promoter) return coupon.promoter;
  const special = await SpecialCoupon.findOne({ code: upper })
    .select("promoter")
    .lean();
  return special?.promoter || null;
};

// Net merchandise = subtotal minus all promotional discounts. Excludes shipping,
// gift wrap and loyalty redemption (those aren't merchandise the promoter drove).
const computeBasisAmount = (pricing) => {
  const subtotal = pricing?.subtotal || 0;
  const bundle = pricing?.bundleDiscountTotal || 0;
  const tier = pricing?.tierDiscount || 0;
  const special = pricing?.specialCouponDiscountTotal || 0;
  const coupon = pricing?.couponDiscount || 0;
  return Math.max(0, subtotal - bundle - tier - special - coupon);
};

const computeCommission = (commission, basisAmount) => {
  if (basisAmount <= 0) return 0;
  if (commission.type === "percentage") {
    return Math.round((basisAmount * (commission.rate || 0)) / 100);
  }
  // fixed_per_order — never exceed the basis
  return Math.min(commission.rate || 0, basisAmount);
};

// Build an attribution snapshot for an order. Returns the subdoc or null.
// Primary = the coupon code used (deterministic); secondary = last-click link.
const resolveOrderAttribution = async (pricing, affiliateRef) => {
  let promoterId = null;
  let via = null;
  let code = null;
  let linkId = null;

  // PRIMARY: code-based. Regular coupon (the explicit single-field entry) wins,
  // then the first owned special-coupon code.
  if (pricing?.couponCode) {
    promoterId = await resolvePromoterByCode(pricing.couponCode);
    if (promoterId) {
      via = "code";
      code = String(pricing.couponCode).toUpperCase();
    }
  }
  if (!promoterId && Array.isArray(pricing?.specialCouponDiscounts)) {
    for (const sp of pricing.specialCouponDiscounts) {
      if (!sp?.code) continue;
      const owner = await resolvePromoterByCode(sp.code);
      if (owner) {
        promoterId = owner;
        via = "code";
        code = String(sp.code).toUpperCase();
        break;
      }
    }
  }

  // SECONDARY: last-click link (only when no owned code was used).
  if (!promoterId && affiliateRef?.slug) {
    const link = await PromoterLink.findOne({
      slug: String(affiliateRef.slug).toLowerCase(),
      isActive: true,
    })
      .select("promoter")
      .lean();
    if (link?.promoter) {
      promoterId = link.promoter;
      via = "link";
      linkId = link._id;
    }
  }

  if (!promoterId) return null;

  const promoter = await Promoter.findById(promoterId).lean();
  if (!promoter || promoter.status !== "active") return null;

  const config = await getPromoterConfig();
  if (!config.enabled) return null;

  const commission = {
    type: promoter.commission?.type || config.defaultCommissionType,
    rate:
      promoter.commission?.rate != null
        ? promoter.commission.rate
        : config.defaultCommissionRate,
    minOrderValue: promoter.commission?.minOrderValue || 0,
  };

  const basisAmount = computeBasisAmount(pricing);
  const commissionAmount =
    basisAmount < commission.minOrderValue
      ? 0
      : computeCommission(commission, basisAmount);

  return {
    promoter: promoter._id,
    via,
    code,
    link: linkId,
    commissionSnapshot: {
      type: commission.type,
      rate: commission.rate,
      basis: config.commissionBasis,
    },
    basisAmount,
    commissionAmount,
    status: "pending",
  };
};

// ---------------------------------------------------------------------------
// Totals cache (recomputed from the ledger; reach counters are left untouched)
// ---------------------------------------------------------------------------

const recomputePromoterTotals = async (promoterId) => {
  const rows = await CommissionLedger.aggregate([
    { $match: { promoter: promoterId, status: { $ne: "reversed" } } },
    {
      $group: {
        _id: "$status",
        amount: { $sum: "$amount" },
        basis: { $sum: "$basisAmount" },
        orders: { $sum: { $cond: [{ $eq: ["$type", "earned"] }, 1, 0] } },
      },
    },
  ]);

  let pending = 0;
  let approved = 0;
  let settled = 0;
  let revenue = 0;
  let orders = 0;
  for (const r of rows) {
    if (r._id === "pending") pending += r.amount;
    else if (r._id === "approved") approved += r.amount;
    else if (r._id === "settled") settled += r.amount;
    revenue += r.basis || 0;
    orders += r.orders || 0;
  }

  await Promoter.updateOne(
    { _id: promoterId },
    {
      $set: {
        "totals.totalEarned": pending + approved + settled,
        "totals.totalApproved": approved,
        "totals.totalSettled": settled,
        "totals.totalPending": pending,
        "totals.totalRevenue": revenue,
        "totals.totalOrders": orders,
      },
    }
  );
};

// ---------------------------------------------------------------------------
// Accrual + reversal (best-effort, idempotent — mirror referral.service.js)
// ---------------------------------------------------------------------------

// Record commission for a confirmed, attributed order. Safe to call many times.
const accrueCommission = async (order) => {
  const attr = order?.attribution;
  if (!attr?.promoter || !(attr.commissionAmount > 0)) {
    return { success: false, reason: "not_attributed" };
  }

  const promoter = await Promoter.findById(attr.promoter).select(
    "status linkedUser"
  );
  if (!promoter || promoter.status !== "active") {
    return { success: false, reason: "promoter_inactive" };
  }

  // Self-referral guard: a promoter must not earn on their own purchase.
  if (
    order.user &&
    promoter.linkedUser &&
    promoter.linkedUser.toString() === order.user.toString()
  ) {
    return { success: false, reason: "self_referral" };
  }

  // Idempotent insert: one earned row per order. upsertedCount===1 => first time.
  const result = await CommissionLedger.updateOne(
    { order: order._id, type: "earned" },
    {
      $setOnInsert: {
        promoter: attr.promoter,
        order: order._id,
        type: "earned",
        amount: attr.commissionAmount,
        basis: attr.commissionSnapshot?.basis || "net_merchandise",
        basisAmount: attr.basisAmount,
        commissionRate: attr.commissionSnapshot?.rate,
        commissionType: attr.commissionSnapshot?.type,
        status: "pending",
        via: attr.via,
        code: attr.code,
        description: `Commission for order ${order.orderId || order._id}`,
      },
    },
    { upsert: true }
  );

  if (result.upsertedCount !== 1) {
    return { success: false, reason: "already_accrued" };
  }

  // First-time accrual side effects.
  await Promoter.updateOne(
    { _id: attr.promoter },
    { $set: { "totals.lastOrderAt": new Date() } }
  );
  await recomputePromoterTotals(attr.promoter);

  if (attr.via === "link" && attr.link) {
    await PromoterLink.updateOne(
      { _id: attr.link },
      { $inc: { conversionCount: 1 } }
    );
  }

  // Mark the order's attribution confirmed (best-effort).
  try {
    order.attribution.status = "confirmed";
    await order.save();
  } catch {
    /* order may be lean / already saved elsewhere — non-critical */
  }

  return { success: true, amount: attr.commissionAmount };
};

// Reverse commission when an attributed order is cancelled/refunded. Idempotent.
const reverseCommission = async (orderId) => {
  const row = await CommissionLedger.findOne({ order: orderId, type: "earned" });
  if (!row) return { success: false, reason: "not_found" };
  if (row.status === "reversed") {
    return { success: false, reason: "already_reversed" };
  }
  // Settled rows are NOT auto-reversed — surface as a manual clawback instead.
  if (row.status === "settled") {
    return { success: false, reason: "already_settled" };
  }

  row.status = "reversed";
  row.reversedAt = new Date();
  await row.save();

  await recomputePromoterTotals(row.promoter);

  return { success: true };
};

// ---------------------------------------------------------------------------
// Settlement (bookkeeping only)
// ---------------------------------------------------------------------------

// Gather a promoter's approved, unsettled ledger rows into a draft settlement.
const createSettlement = async (promoterId, { periodFrom, periodTo, createdBy } = {}) => {
  const filter = {
    promoter: promoterId,
    status: "approved",
    settlement: null,
  };
  if (periodFrom || periodTo) {
    filter.createdAt = {};
    if (periodFrom) filter.createdAt.$gte = new Date(periodFrom);
    if (periodTo) filter.createdAt.$lte = new Date(periodTo);
  }

  const rows = await CommissionLedger.find(filter).select("_id amount").lean();
  const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);

  const settlement = await Settlement.create({
    settlementId: await generateSettlementId(),
    promoter: promoterId,
    periodFrom: periodFrom ? new Date(periodFrom) : undefined,
    periodTo: periodTo ? new Date(periodTo) : undefined,
    ledgerEntries: rows.map((r) => r._id),
    totalAmount,
    entryCount: rows.length,
    status: "draft",
    createdBy,
  });

  return settlement;
};

// Finalize a draft settlement: atomically flip its approved rows to settled.
const finalizeSettlement = async (settlementId, { reference, method } = {}) => {
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) return { success: false, reason: "not_found" };
  if (settlement.status !== "draft") {
    return { success: false, reason: "not_draft" };
  }

  // Only flip rows still approved & unsettled (guards against double-settle).
  const now = new Date();
  await CommissionLedger.updateMany(
    { _id: { $in: settlement.ledgerEntries }, status: "approved", settlement: null },
    { $set: { status: "settled", settledAt: now, settlement: settlement._id } }
  );

  // Recompute the settled total from what actually flipped.
  const settledRows = await CommissionLedger.find({
    settlement: settlement._id,
    status: "settled",
  })
    .select("amount")
    .lean();
  settlement.totalAmount = settledRows.reduce((s, r) => s + (r.amount || 0), 0);
  settlement.entryCount = settledRows.length;
  settlement.status = "finalized";
  settlement.finalizedAt = now;
  settlement.settledAt = now;
  if (reference !== undefined) settlement.reference = reference;
  if (method) settlement.method = method;
  await settlement.save();

  await recomputePromoterTotals(settlement.promoter);

  return { success: true, settlement };
};

module.exports = {
  getPromoterConfig,
  generatePromoterCode,
  generateLinkSlug,
  generateSettlementId,
  resolvePromoterByCode,
  computeBasisAmount,
  computeCommission,
  resolveOrderAttribution,
  recomputePromoterTotals,
  accrueCommission,
  reverseCommission,
  createSettlement,
  finalizeSettlement,
};
