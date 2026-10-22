// Unit tests for dynamic (Shiprocket) delivery charges: charge-mode config, courier
// choice, charge maths, free-delivery rules, the cached/guarded live quote, the
// pricing decision, and the gift-wrap setting.
// Stubs Settings, ShippingZone, the Shiprocket service and its config via require.cache.
// No database, no network. Run: node tests/shipping-charge-mode.test.js
const assert = require("assert");
const path = require("path");

const stub = (rel, exports) => {
  const p = require.resolve(path.join(__dirname, "../src", rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

// ── controllable stubs ───────────────────────────────────────────────────────
let settingsDocs = {}; // key -> value
stub("models/Settings", {
  findOne: ({ key }) => ({ lean: async () => (key in settingsDocs ? { key, value: settingsDocs[key] } : null) }),
  find: ({ key }) => ({
    lean: async () => (key.$in || []).filter((k) => k in settingsDocs).map((k) => ({ key: k, value: settingsDocs[k] })),
  }),
});
stub("models/ShippingZone", { find: () => ({ select: () => ({ lean: async () => [] }) }) });

let srCalls = [];
let srImpl = async () => ({ available: true, source: "shiprocket", couriers: [] });
stub("services/shiprocket.service", {
  checkServiceability: (...args) => {
    srCalls.push(args);
    return srImpl(...args);
  },
});

let srConfig = { pickupPincode: "452001", pkg: { weight: 0.5 }, defaultCourierId: "" };
stub("utils/shiprocketConfig", { getConfig: async () => srConfig });

const rate = require("../src/services/shippingRate.service");
const mode = require("../src/utils/shippingChargeMode");
const { getGiftWrapCost, invalidate: invalidateGift } = require("../src/utils/giftWrapCost");
const { resolveBaseShipping } = require("../src/services/pricing.service");

const COURIERS = [
  { courierId: 10, name: "Delhivery Surface", rate: 71, estimatedDays: 4 },
  { courierId: 20, name: "BlueDart Air", rate: 120, estimatedDays: 1 },
  { courierId: 30, name: "Ekart", rate: 58, estimatedDays: 5 },
];
const live = (couriers = COURIERS, extra = {}) => async () => ({
  available: true,
  source: "shiprocket",
  couriers,
  ...extra,
});

const reset = () => {
  srCalls = [];
  srImpl = live();
  srConfig = { pickupPincode: "452001", pkg: { weight: 0.5 }, defaultCourierId: "" };
  rate._cache.clear();
  rate._inflight.clear();
};

let passed = 0;
const t = async (name, fn) => {
  reset();
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const dyn = (over = {}) => mode.normalize({ mode: "dynamic", ...over });

(async () => {
  // ── charge-mode config ─────────────────────────────────────────────────────
  await t("normalize: empty/garbage → safe static defaults", async () => {
    for (const bad of [null, undefined, "x", 5, [], { mode: "weird", courierRule: "??", cap: "abc", adjustment: "z" }]) {
      const c = mode.normalize(bad);
      assert.strictEqual(c.mode, "static");
      assert.strictEqual(c.courierRule, "ours");
      assert.strictEqual(c.freeThreshold.mode, "static");
      assert.strictEqual(c.adjustment, 0);
      assert.strictEqual(c.cap, null);
    }
  });

  await t("normalize: a custom free threshold of 0 is ignored (would make everything free)", async () => {
    assert.strictEqual(mode.normalize({ mode: "dynamic", freeThreshold: { mode: "custom", amount: 0 } }).freeThreshold.mode, "static");
    assert.strictEqual(mode.normalize({ mode: "dynamic", freeThreshold: { mode: "custom", amount: 999 } }).freeThreshold.amount, 999);
  });

  await t("validate: accepts a full valid config and keeps negative adjustment", async () => {
    const c = mode.validate({ mode: "dynamic", courierRule: "cheapest", freeThreshold: { mode: "custom", amount: "1500" }, adjustment: "-10", cap: "150" });
    assert.deepStrictEqual(c, { mode: "dynamic", courierRule: "cheapest", freeThreshold: { mode: "custom", amount: 1500 }, adjustment: -10, cap: 150 });
  });

  await t("validate: rejects bad input with a clear 400", async () => {
    const base = { mode: "dynamic", courierRule: "ours", freeThreshold: { mode: "static", amount: 0 } };
    const bad = [
      { ...base, mode: "live" },
      { ...base, courierRule: "random" },
      { ...base, freeThreshold: { mode: "sometimes" } },
      { ...base, freeThreshold: { mode: "custom", amount: 0 } },
      { ...base, adjustment: "lots" },
      { ...base, cap: -5 },
      null,
    ];
    for (const b of bad) assert.throws(() => mode.validate(b), (e) => e.statusCode === 400, JSON.stringify(b));
  });

  await t("validate: empty cap means no cap", async () => {
    assert.strictEqual(mode.validate({ mode: "static", courierRule: "ours", freeThreshold: { mode: "static" }, cap: "" }).cap, null);
  });

  await t("getConfig/setConfig round-trip through Settings; missing doc = static", async () => {
    settingsDocs = {};
    mode.invalidate();
    assert.strictEqual((await mode.getConfig()).mode, "static");
    settingsDocs = { shipping_charge_mode: { mode: "dynamic", courierRule: "fastest" } };
    mode.invalidate();
    const c = await mode.getConfig();
    assert.strictEqual(c.mode, "dynamic");
    assert.strictEqual(c.courierRule, "fastest");
    settingsDocs = {};
    mode.invalidate();
  });

  // ── courier choice ─────────────────────────────────────────────────────────
  await t("pickCourier cheapest / fastest", async () => {
    assert.strictEqual(rate.pickCourier(COURIERS, "cheapest").courier.courierId, 30);
    assert.strictEqual(rate.pickCourier(COURIERS, "fastest").courier.courierId, 20);
  });

  await t("pickCourier ours: default courier wins, then recommended, then cheapest", async () => {
    let p = rate.pickCourier(COURIERS, "ours", { defaultCourierId: "10", recommendedCourierId: 20 });
    assert.strictEqual(p.courier.courierId, 10);
    assert.strictEqual(p.via, "default");
    p = rate.pickCourier(COURIERS, "ours", { defaultCourierId: "999", recommendedCourierId: 20 });
    assert.strictEqual(p.courier.courierId, 20);
    assert.strictEqual(p.via, "recommended");
    p = rate.pickCourier(COURIERS, "ours", { defaultCourierId: "", recommendedCourierId: null });
    assert.strictEqual(p.courier.courierId, 30);
    assert.strictEqual(p.via, "cheapest");
  });

  await t("pickCourier: ties are broken sensibly; unusable rates are ignored; empty → null", async () => {
    const tie = [
      { courierId: 1, rate: 60, estimatedDays: 5 },
      { courierId: 2, rate: 60, estimatedDays: 2 },
    ];
    assert.strictEqual(rate.pickCourier(tie, "cheapest").courier.courierId, 2); // same price → faster
    const tieDays = [
      { courierId: 1, rate: 90, estimatedDays: 2 },
      { courierId: 2, rate: 70, estimatedDays: 2 },
    ];
    assert.strictEqual(rate.pickCourier(tieDays, "fastest").courier.courierId, 2); // same days → cheaper
    const junk = [{ courierId: 1, rate: "n/a" }, { courierId: 2, rate: -4 }, { courierId: 3, rate: 80, estimatedDays: 3 }];
    assert.strictEqual(rate.pickCourier(junk, "cheapest").courier.courierId, 3);
    assert.strictEqual(rate.pickCourier([], "ours"), null);
    assert.strictEqual(rate.pickCourier(undefined, "cheapest"), null);
  });

  // ── charge maths + free rule ───────────────────────────────────────────────
  await t("computeCharge: adjustment, rounding, cap, never below 0", async () => {
    assert.strictEqual(rate.computeCharge(71), 71);
    assert.strictEqual(rate.computeCharge(71.4), 71);
    assert.strictEqual(rate.computeCharge(71.5), 72);
    assert.strictEqual(rate.computeCharge(71, { adjustment: 9 }), 80);
    assert.strictEqual(rate.computeCharge(71, { adjustment: -100 }), 0);
    assert.strictEqual(rate.computeCharge(200, { cap: 150 }), 150);
    assert.strictEqual(rate.computeCharge(120, { adjustment: 50, cap: 150 }), 150);
    assert.strictEqual(rate.computeCharge("abc"), null);
  });

  await t("resolveFreeAbove: static mode ignores the dynamic rule; dynamic honours static/custom/off", async () => {
    assert.strictEqual(rate.resolveFreeAbove(mode.normalize({ mode: "static", freeThreshold: { mode: "off" } }), 1200), 1200);
    assert.strictEqual(rate.resolveFreeAbove(dyn(), 1200), 1200);
    assert.strictEqual(rate.resolveFreeAbove(dyn({ freeThreshold: { mode: "custom", amount: 1800 } }), 1200), 1800);
    assert.strictEqual(rate.resolveFreeAbove(dyn({ freeThreshold: { mode: "off" } }), 1200), Infinity);
  });

  // ── live quote ─────────────────────────────────────────────────────────────
  await t("quote: uses the pickup/weight config, COD flag, and the default courier", async () => {
    srConfig = { pickupPincode: "452001", pkg: { weight: 0.75 }, defaultCourierId: "10" };
    const q = await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() });
    assert.strictEqual(q.charge, 71);
    assert.strictEqual(q.courierName, "Delhivery Surface");
    assert.strictEqual(q.via, "default");
    assert.deepStrictEqual(srCalls[0], ["400001", 0.75, 1]); // pincode, weight, cod=1
    await rate.quoteShiprocketCharge({ pincode: "400001", method: "razorpay", config: dyn() });
    assert.strictEqual(srCalls[1][2], 0); // prepaid → cod=0
  });

  await t("quote: applies adjustment and cap on top of the courier rate", async () => {
    const q = await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn({ courierRule: "fastest", adjustment: 20, cap: 130 }) });
    assert.strictEqual(q.rate, 120);
    assert.strictEqual(q.charge, 130); // 120 + 20 = 140, capped at 130
  });

  await t("quote: Shiprocket's recommended courier is used when no default is set", async () => {
    srImpl = live(COURIERS, { recommendedCourierId: 20 });
    const q = await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() });
    assert.strictEqual(q.courierId, 20);
    assert.strictEqual(q.via, "recommended");
  });

  await t("quote: never prices simulated (test mode) or fallback answers", async () => {
    srImpl = async () => ({ available: true, source: "test", couriers: [{ courierId: 1, rate: 50, estimatedDays: 3 }] });
    assert.strictEqual(await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() }), null);
    rate._cache.clear();
    srImpl = async () => ({ available: true, source: "fallback", couriers: [] });
    assert.strictEqual(await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() }), null);
  });

  await t("quote: API errors and empty courier lists return null (caller falls back to static)", async () => {
    srImpl = async () => { throw new Error("Shiprocket down"); };
    assert.strictEqual(await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() }), null);
    rate._cache.clear();
    srImpl = live([]);
    assert.strictEqual(await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() }), null);
  });

  await t("quote: invalid pincodes never hit Shiprocket", async () => {
    for (const bad of ["", "1234", "abcdef", "4000011", undefined, null]) {
      assert.strictEqual(await rate.quoteShiprocketCharge({ pincode: bad, method: "cod", config: dyn() }), null);
    }
    assert.strictEqual(srCalls.length, 0);
  });

  await t("quote: cached per lane (same price on repeat), separate for COD vs prepaid", async () => {
    await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() });
    await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() });
    assert.strictEqual(srCalls.length, 1);
    await rate.quoteShiprocketCharge({ pincode: "400001", method: "razorpay", config: dyn() });
    assert.strictEqual(srCalls.length, 2);
    await rate.quoteShiprocketCharge({ pincode: "110001", method: "cod", config: dyn() });
    assert.strictEqual(srCalls.length, 3);
  });

  await t("quote: a failure is remembered briefly instead of retried per request", async () => {
    srImpl = async () => { throw new Error("down"); };
    await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() });
    await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() });
    assert.strictEqual(srCalls.length, 1);
  });

  await t("quote: concurrent requests for one lane share a single upstream call", async () => {
    srImpl = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { available: true, source: "shiprocket", couriers: COURIERS };
    };
    const rs = await Promise.all(Array.from({ length: 5 }, () => rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() })));
    assert.strictEqual(srCalls.length, 1);
    assert.ok(rs.every((q) => q && q.charge === rs[0].charge));
  });

  await t("quote: a hung Shiprocket call times out and falls back (null)", async () => {
    srImpl = () => new Promise(() => {}); // never resolves
    const started = Date.now();
    assert.strictEqual(await rate.quoteShiprocketCharge({ pincode: "400001", method: "cod", config: dyn() }), null);
    const took = Date.now() - started;
    assert.ok(took >= 3500 && took < 6000, `expected ~4s timeout, took ${took}ms`);
  });

  // ── pricing decision (static vs dynamic) ───────────────────────────────────
  const STATIC = { standardRate: 49, freeAbove: 1200, zone: null };
  const decide = (over) => resolveBaseShipping({ subtotal: 500, staticShipping: STATIC, chargeMode: mode.normalize({ mode: "static" }), location: { pincode: "400001" }, paymentMethod: "razorpay", ...over });

  await t("static mode: exactly the old behaviour, and Shiprocket is never called", async () => {
    let d = await decide({});
    assert.deepStrictEqual(d, { cost: 49, source: "static", pending: false, courier: null, etaDays: null });
    d = await decide({ subtotal: 1200 });
    assert.strictEqual(d.cost, 0);
    d = await decide({ subtotal: 1199 });
    assert.strictEqual(d.cost, 49);
    assert.strictEqual(srCalls.length, 0);
  });

  await t("static mode ignores a configured dynamic free-threshold rule", async () => {
    const cfg = mode.normalize({ mode: "static", freeThreshold: { mode: "off" } });
    assert.strictEqual((await decide({ chargeMode: cfg, subtotal: 5000 })).cost, 0);
  });

  await t("dynamic mode: below the free amount charges the live quote", async () => {
    const d = await decide({ chargeMode: dyn(), method: undefined });
    assert.strictEqual(d.cost, 58); // "ours" with no default/recommended → cheapest (Ekart 58)
    assert.strictEqual(d.source, "shiprocket");
    assert.strictEqual(d.pending, false);
    assert.strictEqual(d.courier, "Ekart");
    assert.strictEqual(d.etaDays, 5);
  });

  await t("dynamic mode: at/above the free amount is free and skips Shiprocket", async () => {
    const d = await decide({ chargeMode: dyn(), subtotal: 1500 });
    assert.strictEqual(d.cost, 0);
    assert.strictEqual(srCalls.length, 0);
  });

  await t("dynamic mode: custom free amount and 'off' are honoured", async () => {
    let d = await decide({ chargeMode: dyn({ freeThreshold: { mode: "custom", amount: 2000 } }), subtotal: 1500 });
    assert.strictEqual(d.cost, 58); // 1500 < 2000 → not free any more
    d = await decide({ chargeMode: dyn({ freeThreshold: { mode: "custom", amount: 400 } }), subtotal: 500 });
    assert.strictEqual(d.cost, 0);
    d = await decide({ chargeMode: dyn({ freeThreshold: { mode: "off" } }), subtotal: 99999 });
    assert.strictEqual(d.cost, 58); // never free
  });

  await t("dynamic mode: no pincode yet → static estimate flagged pending, no Shiprocket call", async () => {
    for (const location of [null, {}, { pincode: "" }, { pincode: "12" }]) {
      const d = await decide({ chargeMode: dyn(), location });
      assert.strictEqual(d.cost, 49);
      assert.strictEqual(d.pending, true);
      assert.strictEqual(d.source, "static");
    }
    assert.strictEqual(srCalls.length, 0);
  });

  await t("dynamic mode: Shiprocket unavailable → static rate, flagged static-fallback", async () => {
    srImpl = async () => { throw new Error("down"); };
    const d = await decide({ chargeMode: dyn() });
    assert.strictEqual(d.cost, 49);
    assert.strictEqual(d.source, "static-fallback");
    assert.strictEqual(d.pending, false);
  });

  await t("dynamic mode: COD and prepaid quote different lanes", async () => {
    srImpl = async (pin, w, cod) => ({
      available: true,
      source: "shiprocket",
      couriers: [{ courierId: 1, name: "X", rate: cod ? 95 : 60, estimatedDays: 3 }],
    });
    assert.strictEqual((await decide({ chargeMode: dyn(), paymentMethod: "cod" })).cost, 95);
    assert.strictEqual((await decide({ chargeMode: dyn(), paymentMethod: "razorpay" })).cost, 60);
  });

  // ── gift wrap setting ──────────────────────────────────────────────────────
  await t("gift wrap: admin setting wins, then the legacy key, then the constant", async () => {
    settingsDocs = { GIFT_WRAP_COST: 149, gift_wrap_cost: 99 };
    invalidateGift();
    assert.strictEqual(await getGiftWrapCost(), 149);
    settingsDocs = { gift_wrap_cost: 79 };
    invalidateGift();
    assert.strictEqual(await getGiftWrapCost(), 79);
    settingsDocs = {};
    invalidateGift();
    assert.strictEqual(await getGiftWrapCost(), 99);
    settingsDocs = { GIFT_WRAP_COST: "free", gift_wrap_cost: -3 };
    invalidateGift();
    assert.strictEqual(await getGiftWrapCost(), 99); // junk ignored
    settingsDocs = { GIFT_WRAP_COST: 0 };
    invalidateGift();
    assert.strictEqual(await getGiftWrapCost(), 0); // free gift wrap is a valid choice
    settingsDocs = {};
    invalidateGift();
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((e) => {
  console.error("\nFAILED:", e);
  process.exit(1);
});
