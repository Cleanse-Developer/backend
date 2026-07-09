// Live lifecycle test for the promoter/commission flow against a REAL MongoDB.
// Point MONGODB_URI at a LOCAL/test database (never prod). Run:
//   MONGODB_URI="mongodb://127.0.0.1:27018/cleanse_promoter_test" node tests/promoter.integration.test.js
const assert = require("assert");
const mongoose = require("mongoose");

const Promoter = require("../src/models/Promoter");
const PromoterLink = require("../src/models/PromoterLink");
const Coupon = require("../src/models/Coupon");
const SpecialCoupon = require("../src/models/SpecialCoupon");
const CommissionLedger = require("../src/models/CommissionLedger");
const Settlement = require("../src/models/Settlement");
const Order = require("../src/models/Order");
const svc = require("../src/services/promoter.service");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 86400000;
let passed = 0;
let failed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  XX  ${name}\n        ${err.message}`);
  }
};

let seq = 0;
const freshPromoter = (over = {}) => {
  seq++;
  return Promoter.create({
    name: `P${seq}`,
    code: `P${seq}-${Math.floor(Math.random() * 1e6)}`,
    commission: { type: "percentage", rate: 10, minOrderValue: 0, ...(over.commission || {}) },
    status: over.status || "active",
    linkedUser: over.linkedUser || null,
    createdBy: oid(),
  });
};
const freshCoupon = (promoterId, code) =>
  Coupon.create({
    code,
    description: "c",
    discountType: "percentage",
    discountValue: 10,
    validTill: new Date(Date.now() + 30 * DAY),
    promoter: promoterId,
  });
const makeOrder = (over = {}) =>
  Order.create({
    orderId: over.orderId || `TST-${Math.floor(Math.random() * 1e9)}`,
    user: over.user || oid(),
    items: [{ product: oid(), name: "Item", price: 800, quantity: 1 }],
    shippingAddress: {
      fullName: "B", phone: "9999999999", address1: "1", city: "C", state: "S", pincode: "560001",
    },
    payment: { method: "cod", status: "pending" },
    pricing: { subtotal: 1000, couponDiscount: 200, total: 800, ...(over.pricing || {}) },
    status: over.status || "confirmed",
    ...(over.attribution ? { attribution: over.attribution } : {}),
    ...(over.deliveredAt ? { deliveredAt: over.deliveredAt } : {}),
  });

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri, "MONGODB_URI required");
  assert.ok(!/mongodb\.net/.test(uri), "Refusing to run against Atlas — use a LOCAL test DB");
  await mongoose.connect(uri);
  await Promise.all([
    Promoter.deleteMany({}), PromoterLink.deleteMany({}), Coupon.deleteMany({}),
    SpecialCoupon.deleteMany({}), CommissionLedger.deleteMany({}), Settlement.deleteMany({}),
    Order.deleteMany({}),
  ]);

  // ── E: Attribution matrix ─────────────────────────────────────────────────
  await t("E1 code attribution → net basis commission (10% of 800)", async () => {
    const p = await freshPromoter();
    await freshCoupon(p._id, "E1CODE");
    const a = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E1CODE", total: 800 }, null);
    assert.ok(a); assert.strictEqual(a.via, "code");
    assert.strictEqual(a.basisAmount, 800); assert.strictEqual(a.commissionAmount, 80);
  });

  await t("E2 non-promoter coupon → null", async () => {
    const a = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 100, couponCode: "SPIN-X", total: 900 }, null);
    assert.strictEqual(a, null);
  });

  await t("E3 link fallback when no code", async () => {
    const p = await freshPromoter();
    await PromoterLink.create({ promoter: p._id, slug: "e3-link" });
    const a = await svc.resolveOrderAttribution({ subtotal: 500, total: 500 }, { slug: "e3-link" });
    assert.ok(a); assert.strictEqual(a.via, "link"); assert.strictEqual(a.commissionAmount, 50);
  });

  await t("E4 paused promoter → null", async () => {
    const p = await freshPromoter({ status: "paused" });
    await freshCoupon(p._id, "E4CODE");
    const a = await svc.resolveOrderAttribution({ subtotal: 1000, couponCode: "E4CODE", total: 1000 }, null);
    assert.strictEqual(a, null);
  });

  await t("E5 archived promoter → null", async () => {
    const p = await freshPromoter({ status: "archived" });
    await freshCoupon(p._id, "E5CODE");
    const a = await svc.resolveOrderAttribution({ subtotal: 1000, couponCode: "E5CODE", total: 1000 }, null);
    assert.strictEqual(a, null);
  });

  await t("E6 minOrderValue gate → commission 0 when basis below min", async () => {
    const p = await freshPromoter({ commission: { rate: 10, minOrderValue: 5000 } });
    await freshCoupon(p._id, "E6CODE");
    const a = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E6CODE", total: 800 }, null);
    assert.ok(a); assert.strictEqual(a.commissionAmount, 0);
  });

  await t("E7 zero/neg basis (fully discounted) → commission 0", async () => {
    const p = await freshPromoter();
    await freshCoupon(p._id, "E7CODE");
    const a = await svc.resolveOrderAttribution(
      { subtotal: 500, couponDiscount: 500, couponCode: "E7CODE", total: 0 }, null);
    assert.ok(a); assert.strictEqual(a.basisAmount, 0); assert.strictEqual(a.commissionAmount, 0);
  });

  await t("E7b accrual skipped when commissionAmount is 0", async () => {
    const p = await freshPromoter();
    await freshCoupon(p._id, "E7BCODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 500, couponDiscount: 500, couponCode: "E7BCODE", total: 0 }, null);
    const o = await makeOrder({ attribution, pricing: { subtotal: 500, couponDiscount: 500, total: 0 } });
    const res = await svc.accrueCommission(o);
    assert.strictEqual(res.success, false);
    assert.strictEqual(await CommissionLedger.countDocuments({ order: o._id }), 0);
  });

  await t("E8 code + link both present → code wins", async () => {
    const pc = await freshPromoter(); await freshCoupon(pc._id, "E8CODE");
    const pl = await freshPromoter(); await PromoterLink.create({ promoter: pl._id, slug: "e8-link" });
    const a = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 0, couponCode: "E8CODE", total: 1000 }, { slug: "e8-link" });
    assert.strictEqual(a.via, "code");
    assert.strictEqual(a.promoter.toString(), pc._id.toString());
  });

  await t("E9 regular coupon wins over special-coupon code", async () => {
    const pr = await freshPromoter(); await freshCoupon(pr._id, "E9REG");
    const ps = await freshPromoter();
    await SpecialCoupon.create({
      code: "E9SPECIAL", title: "s", description: "s", promotionType: "spend_threshold",
      applicationMethod: "code", validTill: new Date(Date.now() + 30 * DAY), promoter: ps._id,
    });
    const a = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 0, couponCode: "E9REG",
        specialCouponDiscounts: [{ code: "E9SPECIAL", specialCouponId: oid() }], total: 1000 }, null);
    assert.strictEqual(a.code, "E9REG");
    assert.strictEqual(a.promoter.toString(), pr._id.toString());
  });

  await t("E9b special-coupon code attributes when no regular coupon", async () => {
    const ps = await freshPromoter();
    const sc = await SpecialCoupon.create({
      code: "E9BSPECIAL", title: "s", description: "s", promotionType: "spend_threshold",
      applicationMethod: "code", validTill: new Date(Date.now() + 30 * DAY), promoter: ps._id,
    });
    const a = await svc.resolveOrderAttribution(
      { subtotal: 1000, specialCouponDiscounts: [{ code: "E9BSPECIAL", specialCouponId: sc._id }], total: 1000 }, null);
    assert.ok(a); assert.strictEqual(a.via, "code"); assert.strictEqual(a.code, "E9BSPECIAL");
  });

  // ── Accrual + reversal ─────────────────────────────────────────────────────
  await t("E10 accrual idempotent (3 calls → 1 earned row)", async () => {
    const p = await freshPromoter(); await freshCoupon(p._id, "E10CODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E10CODE", total: 800 }, null);
    const o = await makeOrder({ attribution });
    await svc.accrueCommission(o); await svc.accrueCommission(o); await svc.accrueCommission(o);
    assert.strictEqual(await CommissionLedger.countDocuments({ order: o._id, type: "earned" }), 1);
  });

  await t("E11 accrual bumps promoter totals + link conversion", async () => {
    const p = await freshPromoter();
    const link = await PromoterLink.create({ promoter: p._id, slug: "e11-link" });
    const attribution = await svc.resolveOrderAttribution({ subtotal: 500, total: 500 }, { slug: "e11-link" });
    const o = await makeOrder({ attribution, pricing: { subtotal: 500, total: 500 } });
    await svc.accrueCommission(o);
    const pp = await Promoter.findById(p._id).lean();
    assert.strictEqual(pp.totals.totalPending, 50);
    assert.strictEqual(pp.totals.totalOrders, 1);
    assert.strictEqual((await PromoterLink.findById(link._id).lean()).conversionCount, 1);
  });

  await t("E12 self-referral (buyer == linkedUser) → skipped", async () => {
    const buyer = oid();
    const p = await freshPromoter({ linkedUser: buyer }); await freshCoupon(p._id, "E12CODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E12CODE", total: 800 }, null);
    const o = await makeOrder({ attribution, user: buyer });
    const res = await svc.accrueCommission(o);
    assert.strictEqual(res.reason, "self_referral");
    assert.strictEqual(await CommissionLedger.countDocuments({ order: o._id }), 0);
  });

  await t("E13 reverse pending → reversed, idempotent, totals to 0", async () => {
    const p = await freshPromoter(); await freshCoupon(p._id, "E13CODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E13CODE", total: 800 }, null);
    const o = await makeOrder({ attribution });
    await svc.accrueCommission(o);
    assert.strictEqual((await svc.reverseCommission(o._id)).success, true);
    assert.strictEqual((await svc.reverseCommission(o._id)).success, false);
    assert.strictEqual((await CommissionLedger.findOne({ order: o._id })).status, "reversed");
    assert.strictEqual((await Promoter.findById(p._id).lean()).totals.totalPending, 0);
  });

  await t("E14 reverse approved → reversed", async () => {
    const p = await freshPromoter(); await freshCoupon(p._id, "E14CODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E14CODE", total: 800 }, null);
    const o = await makeOrder({ attribution });
    await svc.accrueCommission(o);
    await CommissionLedger.updateOne({ order: o._id }, { $set: { status: "approved" } });
    assert.strictEqual((await svc.reverseCommission(o._id)).success, true);
    assert.strictEqual((await CommissionLedger.findOne({ order: o._id })).status, "reversed");
  });

  await t("E15 reverse SETTLED → refused (manual clawback)", async () => {
    const p = await freshPromoter(); await freshCoupon(p._id, "E15CODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E15CODE", total: 800 }, null);
    const o = await makeOrder({ attribution });
    await svc.accrueCommission(o);
    await CommissionLedger.updateOne({ order: o._id }, { $set: { status: "settled" } });
    const res = await svc.reverseCommission(o._id);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, "already_settled");
    assert.strictEqual((await CommissionLedger.findOne({ order: o._id })).status, "settled");
  });

  await t("E16 approval sweep: delivered+aged→approved; recent/undelivered stay", async () => {
    const p = await freshPromoter(); await freshCoupon(p._id, "E16CODE");
    const attr = () => svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E16CODE", total: 800 }, null);
    const aged = await makeOrder({ attribution: await attr(), status: "delivered", deliveredAt: new Date(Date.now() - 30 * DAY) });
    const recent = await makeOrder({ attribution: await attr(), status: "delivered", deliveredAt: new Date(Date.now() - 1 * DAY) });
    const undel = await makeOrder({ attribution: await attr(), status: "confirmed" });
    await svc.accrueCommission(aged); await svc.accrueCommission(recent); await svc.accrueCommission(undel);

    const cutoff = new Date(Date.now() - 7 * DAY);
    const orders = await Order.find({ "attribution.promoter": p._id, status: "delivered", deliveredAt: { $lte: cutoff } }).select("_id");
    await CommissionLedger.updateMany(
      { order: { $in: orders.map((o) => o._id) }, status: "pending", type: "earned" },
      { $set: { status: "approved", approvedAt: new Date() } });

    assert.strictEqual((await CommissionLedger.findOne({ order: aged._id })).status, "approved");
    assert.strictEqual((await CommissionLedger.findOne({ order: recent._id })).status, "pending");
    assert.strictEqual((await CommissionLedger.findOne({ order: undel._id })).status, "pending");
  });

  await t("E17 createSettlement with no approved rows → empty draft (entryCount 0)", async () => {
    const p = await freshPromoter();
    const s = await svc.createSettlement(p._id, { createdBy: oid() });
    assert.strictEqual(s.entryCount, 0);
    assert.strictEqual(s.totalAmount, 0);
  });

  await t("E18 settlement finalize flips approved→settled; double finalize refused", async () => {
    const p = await freshPromoter(); await freshCoupon(p._id, "E18CODE");
    const attribution = await svc.resolveOrderAttribution(
      { subtotal: 1000, couponDiscount: 200, couponCode: "E18CODE", total: 800 }, null);
    const o = await makeOrder({ attribution });
    await svc.accrueCommission(o);
    await CommissionLedger.updateOne({ order: o._id }, { $set: { status: "approved" } });
    await svc.recomputePromoterTotals(p._id);
    const draft = await svc.createSettlement(p._id, { createdBy: oid() });
    assert.strictEqual(draft.entryCount, 1);
    const fin = await svc.finalizeSettlement(draft._id, { reference: "UTR1" });
    assert.strictEqual(fin.success, true);
    assert.strictEqual((await CommissionLedger.findOne({ order: o._id })).status, "settled");
    const again = await svc.finalizeSettlement(draft._id, { reference: "UTR2" });
    assert.strictEqual(again.success, false);
    assert.strictEqual(again.reason, "not_draft");
    const pp = await Promoter.findById(p._id).lean();
    assert.strictEqual(pp.totals.totalSettled, 80);
    assert.strictEqual(pp.totals.totalApproved, 0);
  });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nFATAL:", err.stack || err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
