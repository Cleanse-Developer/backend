// Unit test for zone-vs-global shipping rate resolution.
// Stubs Settings + ShippingZone via require.cache. Run: node tests/shipping-rate.test.js
const assert = require("assert");
const path = require("path");

const stub = (rel, exports) => {
  const p = require.resolve(path.join(__dirname, "../src", rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

// Global standard rate from admin Settings = 99
stub("models/Settings", {
  findOne: () => ({ lean: async () => ({ value: { STANDARD_RATE: 99 } }) }),
});

// One active zone: Indore — specific pincodes + state MP, standard rate 1
const ZONES = [
  { name: "Indore", pincodes: ["452001", "453331", "452021", "452016"], states: ["Madhya Pradesh"], rates: { standard: 1, freeAbove: 1200 } },
];
stub("models/ShippingZone", {
  find: () => ({ select: () => ({ lean: async () => ZONES }) }),
});

const { resolveShippingConfig } = require("../src/services/pricing.service");

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };

(async () => {
  await t("pincode in a zone → zone rate", async () => {
    const r = await resolveShippingConfig({ pincode: "452001", state: "Madhya Pradesh" });
    assert.strictEqual(r.standardRate, 1);
    assert.strictEqual(r.zone, "Indore");
  });

  await t("pincode in NO zone (diff state) → global rate", async () => {
    const r = await resolveShippingConfig({ pincode: "400001", state: "Maharashtra" });
    assert.strictEqual(r.standardRate, 99);
    assert.strictEqual(r.zone, null);
  });

  await t("state-wide match (pincode not listed, state listed) → zone rate", async () => {
    const r = await resolveShippingConfig({ pincode: "452999", state: "Madhya Pradesh" });
    assert.strictEqual(r.standardRate, 1);
    assert.strictEqual(r.zone, "Indore");
  });

  await t("no location → global rate", async () => {
    const r = await resolveShippingConfig(null);
    assert.strictEqual(r.standardRate, 99);
    assert.strictEqual(r.zone, null);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
