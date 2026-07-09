// End-to-end ORDER LIFECYCLE test through the real controllers:
// place COD order with a promoter code → attribution stamped + commission accrued;
// place order via a promoter link (no code) → link attribution; cancel → reversal.
// Requires a backend on a REPLICA-SET local DB (transactions) with WHATSAPP_COD_HOLD=false.
//   BASE=http://localhost:5055 MONGODB_URI="mongodb://127.0.0.1:27019/cleanse_order?replicaSet=rs0" node tests/promoter.order.test.js
const assert = require("assert");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Product = require("../src/models/Product");
const Cart = require("../src/models/Cart");
const Order = require("../src/models/Order");
const Coupon = require("../src/models/Coupon");
const Promoter = require("../src/models/Promoter");
const PromoterLink = require("../src/models/PromoterLink");
const CommissionLedger = require("../src/models/CommissionLedger");

const BASE = process.env.BASE || "http://localhost:5055";
const DAY = 86400000;
let passed = 0, failed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failed++; console.log(`  XX  ${name}\n        ${err.message}`); }
};

let TOKEN = "";
const api = async (method, path, body) => {
  const headers = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

const SHIP = {
  fullName: "Cust One", phone: "9812345678", address1: "1 Rd",
  city: "Bengaluru", state: "Karnataka", pincode: "560001",
};

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri && !/mongodb\.net/.test(uri), "LOCAL MONGODB_URI required");
  await mongoose.connect(uri);

  const CUST_EMAIL = "cust-e2e@test.com";
  await Promise.all([
    User.deleteMany({ email: CUST_EMAIL }),
    Product.deleteMany({ slug: "e2e-serum" }),
    Coupon.deleteMany({ code: { $in: ["PROMO10", "PROMO10B"] } }),
    Promoter.deleteMany({ code: { $in: ["ORDPROMO", "ORDPROMO2"] } }),
    PromoterLink.deleteMany({ slug: "ord-link" }),
  ]);

  const customer = await User.create({
    fullName: "Cust One", email: CUST_EMAIL, phone: "9812345678", countryCode: "+91",
    password: await bcrypt.hash("Pass@123", 12), role: "customer", status: "active",
  });
  const product = await Product.create({
    name: "E2E Serum", slug: "e2e-serum", description: "d", price: 800, tag: "Face Care",
    sizes: [{ label: "50ml", price: 800, stock: 100, sku: "E2E-50" }], totalStock: 100, isActive: true,
    images: [{ url: "/x.jpg", isPrimary: true }],
  });
  const oid = () => new mongoose.Types.ObjectId();
  const promoter = await Promoter.create({
    name: "OrdPromo", code: "ORDPROMO",
    commission: { type: "percentage", rate: 10, minOrderValue: 0 }, createdBy: oid(),
  });
  await Coupon.create({
    code: "PROMO10", description: "10%", discountType: "percentage", discountValue: 10,
    validTill: new Date(Date.now() + 30 * DAY), promoter: promoter._id,
  });
  const promoter2 = await Promoter.create({
    name: "OrdPromo2", code: "ORDPROMO2",
    commission: { type: "percentage", rate: 20, minOrderValue: 0 }, createdBy: oid(),
  });
  await PromoterLink.create({ promoter: promoter2._id, slug: "ord-link" });

  await t("login customer → token", async () => {
    const r = await api("POST", "/api/auth/login", { email: CUST_EMAIL, password: "Pass@123" });
    assert.strictEqual(r.status, 200);
    TOKEN = r.json.data.accessToken;
    assert.ok(TOKEN);
  });

  const addToCart = async () => {
    const r = await api("POST", "/api/cart/items", { productId: product._id.toString(), quantity: 1, selectedSize: "50ml" });
    assert.ok(r.status === 200 || r.status === 201, `cart add status ${r.status}: ${JSON.stringify(r.json)}`);
  };

  let codeOrderId;
  await t("F1 place COD order with promoter code → attribution stamped", async () => {
    await addToCart();
    const r = await api("POST", "/api/orders", {
      paymentMethod: "cod", shippingInfo: SHIP, couponCode: "PROMO10",
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    const order = r.json.data.order;
    codeOrderId = order._id;
    assert.ok(order.attribution, "attribution present on order");
    assert.strictEqual(order.attribution.promoter, promoter._id.toString());
    assert.strictEqual(order.attribution.via, "code");
    assert.strictEqual(order.attribution.code, "PROMO10");
  });

  await t("F2 commission accrued (pending) with correct net-basis amount", async () => {
    const order = await Order.findById(codeOrderId).lean();
    const p = order.pricing;
    const basis = p.subtotal - (p.bundleDiscountTotal || 0) - (p.tierDiscount || 0)
      - (p.specialCouponDiscountTotal || 0) - (p.couponDiscount || 0);
    const expected = Math.round(basis * 0.10);
    const row = await CommissionLedger.findOne({ order: codeOrderId, type: "earned" }).lean();
    assert.ok(row, "earned ledger row exists");
    assert.strictEqual(row.status, "pending");
    assert.strictEqual(row.amount, expected, `commission ${row.amount} != expected ${expected} (basis ${basis})`);
    assert.strictEqual(order.attribution.commissionAmount, expected);
    const pp = await Promoter.findById(promoter._id).lean();
    assert.strictEqual(pp.totals.totalPending, expected);
    assert.strictEqual(pp.totals.totalOrders, 1);
  });

  await t("F3 place COD order via promoter LINK (no code) → link attribution + conversion", async () => {
    await addToCart();
    const r = await api("POST", "/api/orders", {
      paymentMethod: "cod", shippingInfo: SHIP, attribution: { slug: "ord-link" },
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    const order = r.json.data.order;
    assert.ok(order.attribution, "attribution present");
    assert.strictEqual(order.attribution.via, "link");
    assert.strictEqual(order.attribution.promoter, promoter2._id.toString());
    const link = await PromoterLink.findOne({ slug: "ord-link" }).lean();
    assert.strictEqual(link.conversionCount, 1);
  });

  await t("F4 cancel the code order → commission reversed, totals to 0", async () => {
    const r = await api("POST", `/api/orders/${codeOrderId}/cancel`, { reason: "test" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const row = await CommissionLedger.findOne({ order: codeOrderId, type: "earned" }).lean();
    assert.strictEqual(row.status, "reversed");
    const pp = await Promoter.findById(promoter._id).lean();
    assert.strictEqual(pp.totals.totalPending, 0);
  });

  await t("F5 organic order (no promoter code/link) → no attribution, no ledger", async () => {
    await addToCart();
    const r = await api("POST", "/api/orders", { paymentMethod: "cod", shippingInfo: SHIP });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    const order = r.json.data.order;
    const hasAttr = order.attribution && order.attribution.promoter;
    assert.ok(!hasAttr, "no attribution for organic order");
    const rows = await CommissionLedger.countDocuments({ order: order._id });
    assert.strictEqual(rows, 0);
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
