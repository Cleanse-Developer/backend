// Verifies the service short-circuits to simulated responses in Test mode
// (no real HTTP). Stubs shiprocketMode + config/shiprocket via require.cache.
// Run: node tests/shiprocket.testmode.test.js
const assert = require("assert");
const path = require("path");

const stub = (rel, exports) => {
  const resolved = require.resolve(path.join(__dirname, "../src", rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

let httpCalls = 0;
stub("utils/shiprocketMode", { isTestMode: async () => true });
stub("config/shiprocket", {
  shiprocketRequest: async () => {
    httpCalls++;
    throw new Error("real HTTP should NOT be called in test mode");
  },
});
stub("models/ShippingZone", {});

const sr = require("../src/services/shiprocket.service");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

(async () => {
  await t("createShipment returns simulated id, no HTTP", async () => {
    const r = await sr.createShipment({ orderId: "X", items: [], shippingAddress: {}, billingAddress: {}, payment: {}, pricing: {} });
    assert.ok(String(r.order_id).startsWith("TEST-"));
    assert.ok(String(r.shipment_id).startsWith("TEST-"));
    assert.strictEqual(r.awb_code, "");
  });

  await t("shipForward returns simulated awb + label, no HTTP", async () => {
    const r = await sr.shipForward({ orderId: "X", items: [], shippingAddress: {}, billingAddress: {}, payment: {}, pricing: {} });
    const p = r.payload;
    assert.ok(String(p.awb_code).startsWith("TESTAWB"));
    assert.ok(p.label_url && p.manifest_url);
  });

  await t("assignAWB + cancel + ndr simulated", async () => {
    const a = await sr.assignAWB("TEST-1");
    assert.ok(String(a.awb_code).startsWith("TESTAWB"));
    const c = await sr.cancelShipment(["X"]);
    assert.match(c.message, /Test mode/);
    const n = await sr.ndrAction("X", "return", "c");
    assert.match(n.message, /Test mode/);
  });

  await t("wallet + serviceability simulated", async () => {
    const w = await sr.getWalletBalance();
    assert.ok("balance_amount" in w.data);
    const s = await sr.checkServiceability("400001", 0.5, 1);
    assert.strictEqual(s.available, true);
    assert.ok(s.couriers.length > 0);
  });

  await t("no real HTTP happened", async () => {
    assert.strictEqual(httpCalls, 0);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
