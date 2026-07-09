// End-to-end HTTP test for the promoter admin API + public redirect.
// Requires a backend running against a LOCAL test DB. Env:
//   BASE=http://localhost:5055  MONGODB_URI=mongodb://127.0.0.1:27018/cleanse_http
// Run: BASE=... MONGODB_URI=... node tests/promoter.http.test.js
const assert = require("assert");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Coupon = require("../src/models/Coupon");
const SpecialCoupon = require("../src/models/SpecialCoupon");
const PromoterLink = require("../src/models/PromoterLink");

const BASE = process.env.BASE || "http://localhost:5055";
const DAY = 86400000;
let passed = 0, failed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failed++; console.log(`  XX  ${name}\n        ${err.message}`); }
};

let TOKEN = "";
const api = async (method, path, body, opts = {}) => {
  const headers = { "content-type": "application/json" };
  if (opts.auth !== false && TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: opts.redirect || "follow",
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, res };
};

async function main() {
  const uri = process.env.MONGODB_URI;
  assert.ok(uri && !/mongodb\.net/.test(uri), "LOCAL MONGODB_URI required");
  await mongoose.connect(uri);
  // Clean promoter-related state + seed a known admin.
  await Promise.all([
    mongoose.connection.collection("promoters").deleteMany({}).catch(() => {}),
    PromoterLink.deleteMany({}), Coupon.deleteMany({}), SpecialCoupon.deleteMany({}),
    mongoose.connection.collection("commissionledgers").deleteMany({}).catch(() => {}),
    mongoose.connection.collection("settlements").deleteMany({}).catch(() => {}),
    User.deleteMany({ email: "e2e-admin@test.com" }),
  ]);
  await User.create({
    fullName: "E2E Admin", email: "e2e-admin@test.com", phone: "9000000000",
    countryCode: "+91", password: await bcrypt.hash("Admin@123", 12),
    role: "admin", status: "active",
  });

  // ── A. Auth + CRUD ─────────────────────────────────────────────────────────
  await t("A1 unauth list → 401", async () => {
    const r = await api("GET", "/api/admin/promoters", null, { auth: false });
    assert.strictEqual(r.status, 401);
  });

  await t("A2 admin login → token", async () => {
    const r = await api("POST", "/api/admin/auth/login",
      { email: "e2e-admin@test.com", password: "Admin@123" }, { auth: false });
    assert.strictEqual(r.status, 200);
    TOKEN = r.json.data.accessToken;
    assert.ok(TOKEN, "token present");
  });

  let promoterId, promoterCode;
  await t("A3 create minimal promoter → 201, auto code, active", async () => {
    const r = await api("POST", "/api/admin/promoters", { name: "Riya" });
    assert.strictEqual(r.status, 201);
    const p = r.json.data.promoter;
    promoterId = p._id; promoterCode = p.code;
    assert.ok(p.code, "auto code");
    assert.strictEqual(p.status, "active");
  });

  await t("A4 create without name → 400", async () => {
    const r = await api("POST", "/api/admin/promoters", { channel: "instagram" });
    assert.strictEqual(r.status, 400);
  });

  await t("A5 explicit code create + duplicate → 409", async () => {
    const r1 = await api("POST", "/api/admin/promoters", { name: "Ana", code: "ANA" });
    assert.strictEqual(r1.status, 201);
    const r2 = await api("POST", "/api/admin/promoters", { name: "Ana2", code: "ANA" });
    assert.strictEqual(r2.status, 409);
  });

  await t("A6 list contains created + pagination meta", async () => {
    const r = await api("GET", "/api/admin/promoters?page=1&limit=20");
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.json.data.promoters));
    assert.ok(r.json.data.pagination.total >= 2);
  });

  await t("A7 list search filters by name", async () => {
    const r = await api("GET", "/api/admin/promoters?search=Riya");
    assert.ok(r.json.data.promoters.some((p) => p.name === "Riya"));
  });

  await t("A8 list status filter (paused → excludes active)", async () => {
    const r = await api("GET", "/api/admin/promoters?status=paused");
    assert.ok(r.json.data.promoters.every((p) => p.status === "paused"));
  });

  await t("A9 get by id → promoter + links + codes arrays", async () => {
    const r = await api("GET", `/api/admin/promoters/${promoterId}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.data.promoter);
    assert.ok(Array.isArray(r.json.data.links));
    assert.ok(Array.isArray(r.json.data.codes));
  });

  await t("A10 get with malformed id → 4xx (not 500)", async () => {
    const r = await api("GET", "/api/admin/promoters/not-an-id");
    assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
  });

  await t("A11 update rate + status → 200", async () => {
    const r = await api("PATCH", `/api/admin/promoters/${promoterId}`,
      { commission: { type: "percentage", rate: 15 }, status: "active" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.promoter.commission.rate, 15);
  });

  await t("A12 update code to an existing other code → 409", async () => {
    const r = await api("PATCH", `/api/admin/promoters/${promoterId}`, { code: "ANA" });
    assert.strictEqual(r.status, 409);
  });

  await t("A14 stats returns totals", async () => {
    const r = await api("GET", "/api/admin/promoters/stats");
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.json.data.total === "number");
    assert.ok(typeof r.json.data.totalPending === "number");
  });

  // ── B. Codes ────────────────────────────────────────────────────────────────
  await t("B1 create code → 201, coupon.promoter set, usageLimit unset", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes`, {
      code: "RIYA10", description: "10% off", discountType: "percentage",
      discountValue: 10, validTill: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    assert.strictEqual(r.status, 201);
    const c = await Coupon.findOne({ code: "RIYA10" }).lean();
    assert.strictEqual(c.promoter.toString(), promoterId);
    assert.strictEqual(c.usageLimit, undefined, "usageLimit must be unset (unlimited)");
    assert.strictEqual(c.perUserLimit, 1);
  });

  await t("B2 create code missing fields → 400", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes`, { code: "X" });
    assert.strictEqual(r.status, 400);
  });

  await t("B3 create duplicate code (vs existing coupon) → 409", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes`, {
      code: "RIYA10", description: "d", discountType: "percentage",
      discountValue: 5, validTill: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    assert.strictEqual(r.status, 409);
  });

  await t("B4 create code colliding with a SpecialCoupon code → 409", async () => {
    await SpecialCoupon.create({
      code: "SPX", title: "s", description: "s", promotionType: "spend_threshold",
      applicationMethod: "code", validTill: new Date(Date.now() + 30 * DAY),
    });
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes`, {
      code: "SPX", description: "d", discountType: "percentage",
      discountValue: 5, validTill: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    assert.strictEqual(r.status, 409);
  });

  await t("B5 attach existing coupon → bound", async () => {
    await Coupon.create({ code: "LOOSE1", description: "d", discountType: "fixed",
      discountValue: 50, validTill: new Date(Date.now() + 30 * DAY) });
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes/attach`, { code: "LOOSE1" });
    assert.strictEqual(r.status, 200);
    const c = await Coupon.findOne({ code: "LOOSE1" }).lean();
    assert.strictEqual(c.promoter.toString(), promoterId);
  });

  let otherId;
  await t("B6 attach code owned by another promoter → 409", async () => {
    const other = await api("POST", "/api/admin/promoters", { name: "Other" });
    otherId = other.json.data.promoter._id;
    const r = await api("POST", `/api/admin/promoters/${otherId}/codes/attach`, { code: "RIYA10" });
    assert.strictEqual(r.status, 409);
  });

  await t("B7 attach automatic-method special coupon → 400", async () => {
    await SpecialCoupon.create({
      code: "AUTOX", title: "s", description: "s", promotionType: "spend_threshold",
      applicationMethod: "automatic", validTill: new Date(Date.now() + 30 * DAY),
    });
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes/attach`, { code: "AUTOX" });
    assert.strictEqual(r.status, 400);
  });

  await t("B8 attach nonexistent code → 404", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/codes/attach`, { code: "NOPE999" });
    assert.strictEqual(r.status, 404);
  });

  await t("B9 unbind code → clears promoter", async () => {
    const r = await api("DELETE", `/api/admin/promoters/${promoterId}/codes/LOOSE1`);
    assert.strictEqual(r.status, 200);
    const c = await Coupon.findOne({ code: "LOOSE1" }).lean();
    assert.strictEqual(c.promoter, null);
  });

  await t("B10 unbind code not owned → 404", async () => {
    const r = await api("DELETE", `/api/admin/promoters/${promoterId}/codes/LOOSE1`);
    assert.strictEqual(r.status, 404);
  });

  // ── C. Links ──────────────────────────────────────────────────────────────
  let slug;
  await t("C1 create link (auto slug) → 201", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/links`, { label: "IG bio" });
    assert.strictEqual(r.status, 201);
    slug = r.json.data.link.slug;
    assert.ok(slug);
  });

  await t("C2 explicit slug + duplicate → 409", async () => {
    const r1 = await api("POST", `/api/admin/promoters/${promoterId}/links`, { slug: "riya-yt" });
    assert.strictEqual(r1.status, 201);
    const r2 = await api("POST", `/api/admin/promoters/${promoterId}/links`, { slug: "riya-yt" });
    assert.strictEqual(r2.status, 409);
  });

  await t("C3 bound code owned by promoter → 201", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/links`,
      { slug: "riya-bound", boundCouponCode: "RIYA10" });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.data.link.boundCouponCode, "RIYA10");
  });

  await t("C4 bound code that is not a promoter code → 400", async () => {
    await Coupon.create({ code: "PLAIN1", description: "d", discountType: "fixed",
      discountValue: 10, validTill: new Date(Date.now() + 30 * DAY) });
    const r = await api("POST", `/api/admin/promoters/${promoterId}/links`,
      { slug: "riya-plain", boundCouponCode: "PLAIN1" });
    assert.strictEqual(r.status, 400);
  });

  await t("C5 bound code owned by other promoter → 400", async () => {
    const r = await api("POST", `/api/admin/promoters/${otherId}/links`,
      { slug: "other-bound", boundCouponCode: "RIYA10" });
    assert.strictEqual(r.status, 400);
  });

  await t("C6 update link toggle isActive → 200", async () => {
    const list = await api("GET", `/api/admin/promoters/${promoterId}/links`);
    const linkId = list.json.data.links.find((l) => l.slug === "riya-yt")._id;
    const r = await api("PATCH", `/api/admin/promoters/${promoterId}/links/${linkId}`, { isActive: false });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.link.isActive, false);
  });

  // ── D. Public redirect ──────────────────────────────────────────────────────
  await t("D1 valid slug → 302 to storefront with ?aff (+coupon); click++", async () => {
    const r = await fetch(`${BASE}/r/riya-bound`, { redirect: "manual" });
    assert.strictEqual(r.status, 302);
    const loc = r.headers.get("location");
    assert.ok(loc.includes("aff=riya-bound"), `location: ${loc}`);
    assert.ok(loc.includes("coupon=RIYA10"), `coupon in location: ${loc}`);
    const link = await PromoterLink.findOne({ slug: "riya-bound" }).lean();
    assert.strictEqual(link.clickCount, 1);
    assert.strictEqual(link.uniqueVisitorCount, 1);
  });

  await t("D2 same visitor cookie → click++ but unique stays", async () => {
    await fetch(`${BASE}/r/riya-bound`, { redirect: "manual", headers: { cookie: "pl_vid=fixed-123" } });
    await fetch(`${BASE}/r/riya-bound`, { redirect: "manual", headers: { cookie: "pl_vid=fixed-123" } });
    const link = await PromoterLink.findOne({ slug: "riya-bound" }).lean();
    assert.strictEqual(link.clickCount, 3, `clicks=${link.clickCount}`);
    assert.strictEqual(link.uniqueVisitorCount, 1, `unique=${link.uniqueVisitorCount}`);
  });

  await t("D3 first hit sets pl_vid + promoter_attr cookies", async () => {
    const r = await fetch(`${BASE}/r/riya-yt-need`, { redirect: "manual" }).catch(() => null);
    // riya-yt is inactive; use riya-bound fresh visitor to check Set-Cookie
    const r2 = await fetch(`${BASE}/r/riya-bound`, { redirect: "manual" });
    const setCookie = r2.headers.get("set-cookie") || "";
    assert.ok(/promoter_attr=/.test(setCookie), `set-cookie: ${setCookie}`);
  });

  await t("D4 bot UA → no click increment, still 302", async () => {
    const before = (await PromoterLink.findOne({ slug: "riya-bound" }).lean()).clickCount;
    const r = await fetch(`${BASE}/r/riya-bound`, {
      redirect: "manual", headers: { "user-agent": "Googlebot/2.1" },
    });
    assert.strictEqual(r.status, 302);
    const after = (await PromoterLink.findOne({ slug: "riya-bound" }).lean()).clickCount;
    assert.strictEqual(after, before, "bot must not increment clicks");
  });

  await t("D5 unknown slug → 302 to storefront root", async () => {
    const r = await fetch(`${BASE}/r/does-not-exist`, { redirect: "manual" });
    assert.strictEqual(r.status, 302);
  });

  await t("D6 inactive link → 302 root, no increment", async () => {
    const before = (await PromoterLink.findOne({ slug: "riya-yt" }).lean()).clickCount;
    const r = await fetch(`${BASE}/r/riya-yt`, { redirect: "manual" });
    assert.strictEqual(r.status, 302);
    const link = await PromoterLink.findOne({ slug: "riya-yt" }).lean();
    assert.strictEqual(link.clickCount, before, "inactive link must not increment");
  });

  // ── E-http. Settlement empty → 400 via controller ───────────────────────────
  await t("Ehttp settlement with no approved rows → 400", async () => {
    const r = await api("POST", `/api/admin/promoters/${promoterId}/settlements`, {});
    assert.strictEqual(r.status, 400);
  });

  await t("A13 delete promoter → archived", async () => {
    const r = await api("DELETE", `/api/admin/promoters/${otherId}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.data.promoter.status, "archived");
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
