// Unit test for the create-shiprocket-order job (idempotency + happy path).
// Stubs agenda / Order / shiprocket.service via require.cache.
// Run: node tests/shiprocket.job.test.js
const assert = require("assert");
const path = require("path");

const stub = (rel, exports) => {
  const resolved = require.resolve(path.join(__dirname, "../src", rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

const state = { handler: null, order: null, created: 0, scheduled: [] };

stub("config/agenda", {
  define: (name, fn) => {
    state.handler = fn;
  },
  now: async () => {},
  schedule: async (when, name, data) => {
    state.scheduled.push({ when, name, data });
  },
});
stub("models/Order", { findById: async () => state.order });
stub("services/shiprocket.service", {
  createShipment: async () => {
    state.created++;
    return { order_id: 999, shipment_id: 888 };
  },
});

require("../src/jobs/createShiprocketOrder"); // registers handler via agenda.define
assert.ok(state.handler, "job handler registered");

const fakeOrder = (over = {}) => ({
  orderId: "CA-1",
  shipping: {},
  adminNotes: [],
  saved: false,
  async save() {
    this.saved = true;
  },
  ...over,
});

let passed = 0;
const t = async (name, fn) => {
  state.created = 0;
  state.scheduled = [];
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

(async () => {
  await t("creates adhoc order when none exists", async () => {
    const order = fakeOrder();
    state.order = order;
    await state.handler({ attrs: { data: { orderId: "x" } } });
    assert.strictEqual(state.created, 1);
    assert.strictEqual(order.shipping.shiprocketOrderId, "999");
    assert.strictEqual(order.shipping.shipmentId, "888");
    assert.ok(order.saved);
  });

  await t("idempotent: skips when shiprocketOrderId already set", async () => {
    const order = fakeOrder({ shipping: { shiprocketOrderId: "already" } });
    state.order = order;
    await state.handler({ attrs: { data: { orderId: "x" } } });
    assert.strictEqual(state.created, 0);
  });

  await t("no-op when order not found", async () => {
    state.order = null;
    await state.handler({ attrs: { data: { orderId: "missing" } } });
    assert.strictEqual(state.created, 0);
  });

  await t("reschedules with backoff on transient failure", async () => {
    const order = fakeOrder();
    state.order = order;
    // Swap the service stub to throw, then re-require the job so its
    // destructured createShipment binds to the throwing version.
    const svcPath = require.resolve(path.join(__dirname, "../src/services/shiprocket.service"));
    require.cache[svcPath].exports.createShipment = async () => {
      throw new Error("Shiprocket down");
    };
    const jobPath = require.resolve(path.join(__dirname, "../src/jobs/createShiprocketOrder"));
    delete require.cache[jobPath];
    require("../src/jobs/createShiprocketOrder"); // re-registers state.handler
    await state.handler({ attrs: { data: { orderId: "x", attempt: 1 } } });
    assert.strictEqual(state.scheduled.length, 1);
    assert.strictEqual(state.scheduled[0].data.attempt, 2);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
