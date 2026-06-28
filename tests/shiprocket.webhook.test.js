// Integration tests for the Shiprocket webhook handler. Stubs models/services
// via require.cache, then exercises handleShiprocketTracking with fake req/res.
// Run: node tests/shiprocket.webhook.test.js
const assert = require("assert");
const path = require("path");

process.env.SHIPROCKET_WEBHOOK_TOKEN = "secret-token";
process.env.SHIPROCKET_NDR_MAX_REATTEMPTS = "2";

// --- stub helpers ---
const stub = (relFromController, exports) => {
  const resolved = require.resolve(
    path.join(__dirname, "../src/controllers", relFromController)
  );
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

// In-memory state controllable per test
const state = { order: null, seen: false, created: [], ndrCalls: [], refundCalls: [] };

stub("../models/Order", {
  findOne: async () => state.order,
});
stub("../models/WebhookEvent", {
  exists: async () => state.seen,
  create: async (doc) => {
    state.created.push(doc);
  },
});
stub("../models/ShiprocketWebhookLog", {
  create: async (doc) => {
    state.logs = state.logs || [];
    state.logs.push(doc);
  },
});
stub("../services/shiprocket.service", {
  ndrAction: async (awb, action) => {
    state.ndrCalls.push({ awb, action });
    return {};
  },
});
stub("../services/refund.service", {
  processOrderRefund: async (order, opts) => {
    state.refundCalls.push({ order: order.orderId, opts });
    order.status = "refund_initiated";
    return { refund: { id: "rfnd_1" }, isFullRefund: true };
  },
  restockOrder: async () => {},
});
stub("../services/email.service", { sendEmail: async () => ({}) });
stub("../utils/shiprocketConfig", {
  getConfig: async () => ({ ndrMaxReattempts: 2, adminNotifyEmail: "", warehouse: {}, pkg: {} }),
});

const { handleShiprocketTracking } = require("../src/controllers/shipping.webhook.controller");

const mockRes = () => {
  const r = { statusCode: 0, body: null };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
};

const fakeOrder = (over = {}) => ({
  orderId: "CA-2026-0001",
  status: "shipped",
  payment: { method: "razorpay", status: "paid" },
  shipping: { awbNumber: "AWB1", ndrAttempts: 0 },
  adminNotes: [],
  returnRequest: { status: "requested" },
  saved: false,
  save: async function () {
    this.saved = true;
  },
  ...over,
});

let passed = 0;
const t = async (name, fn) => {
  // reset state
  state.order = null;
  state.seen = false;
  state.created = [];
  state.ndrCalls = [];
  state.refundCalls = [];
  state.logs = [];
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

(async () => {
  await t("401 on missing/bad x-api-key", async () => {
    const res = mockRes();
    await handleShiprocketTracking(
      { headers: {}, body: { awb: "AWB1", current_status_id: 7 } },
      res
    );
    assert.strictEqual(res.statusCode, 401);
  });

  await t("400 on missing awb/status", async () => {
    const res = mockRes();
    await handleShiprocketTracking(
      { headers: { "x-api-key": "secret-token" }, body: { awb: "AWB1" } },
      res
    );
    assert.strictEqual(res.statusCode, 400);
  });

  await t("200 duplicate when already seen", async () => {
    state.seen = true;
    state.order = fakeOrder();
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "AWB1", current_status_id: 7, current_timestamp: "x" },
      },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.duplicate, true);
  });

  await t("200 unknown when no order found", async () => {
    state.order = null;
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "NOPE", current_status_id: 7 },
      },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.unknown, true);
  });

  await t("COD delivered marks payment paid", async () => {
    const order = fakeOrder({
      payment: { method: "cod", status: "pending" },
      status: "out_for_delivery",
    });
    state.order = order;
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "AWB1", current_status_id: 7, current_status: "DELIVERED" },
      },
      res
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(order.status, "delivered");
    assert.strictEqual(order.payment.status, "paid");
    assert.ok(order.saved);
    assert.strictEqual(state.created.length, 1); // dedup recorded
    // attribution: a courier "delivered" entry + a system "COD paid" entry
    assert.ok(order.adminNotes.some((n) => n.actor === "courier"));
    assert.ok(order.adminNotes.some((n) => n.actor === "system" && n.event === "payment:paid"));
  });

  await t("maps on current_status_id when both ids present (regression)", async () => {
    // Real Shiprocket sends BOTH ids in different enums: current_status_id=20
    // (In Transit, canonical) + shipment_status_id=18 (other enum). Must use 20.
    const order = fakeOrder({ status: "shipped" });
    state.order = order;
    await handleShiprocketTracking(
      { headers: { "x-api-key": "secret-token" }, body: { awb: "AWB1", current_status_id: 20, shipment_status_id: 18, current_status: "IN TRANSIT" } },
      mockRes()
    );
    assert.strictEqual(order.status, "in_transit");
  });

  await t("out-of-order in_transit after delivered is ignored", async () => {
    const order = fakeOrder({ status: "delivered" });
    state.order = order;
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "AWB1", current_status_id: 20 }, // In Transit
      },
      res
    );
    assert.strictEqual(order.status, "delivered");
  });

  await t("NDR first attempt -> re-attempt", async () => {
    const order = fakeOrder({ status: "out_for_delivery" });
    state.order = order;
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "AWB1", current_status_id: 36 }, // Undelivered
      },
      res
    );
    assert.strictEqual(order.shipping.ndrAttempts, 1);
    assert.strictEqual(state.ndrCalls[0].action, "re-attempt");
  });

  await t("NDR past cap -> return (RTO)", async () => {
    const order = fakeOrder({ status: "out_for_delivery", shipping: { awbNumber: "AWB1", ndrAttempts: 2 } });
    state.order = order;
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "AWB1", current_status_id: 36 },
      },
      res
    );
    assert.strictEqual(order.shipping.ndrAttempts, 3);
    assert.strictEqual(state.ndrCalls[0].action, "return");
  });

  await t("RTO delivered restocks + auto-refunds prepaid", async () => {
    const order = fakeOrder({ status: "rto_in_transit" });
    state.order = order;
    const res = mockRes();
    await handleShiprocketTracking(
      {
        headers: { "x-api-key": "secret-token" },
        body: { awb: "AWB1", current_status_id: 16 }, // RTO Delivered
      },
      res
    );
    assert.strictEqual(order.shipping.isRTO, true);
    assert.strictEqual(state.refundCalls.length, 1);
  });

  await t("audit log written for every call (processed + unauthorized)", async () => {
    // processed
    state.order = fakeOrder({ status: "shipped" });
    await handleShiprocketTracking(
      { headers: { "x-api-key": "secret-token" }, body: { awb: "AWB1", current_status_id: 20, current_status: "IN TRANSIT", current_timestamp: "t1" } },
      mockRes()
    );
    assert.strictEqual(state.logs.length, 1);
    assert.strictEqual(state.logs[0].result, "processed");
    assert.ok(state.logs[0].payload && state.logs[0].payload.awb === "AWB1", "full payload captured");
    assert.strictEqual(state.logs[0].appliedStatus, "in_transit");

    // unauthorized still logged
    state.logs = [];
    await handleShiprocketTracking({ headers: {}, body: { awb: "AWB1", current_status_id: 7 } }, mockRes());
    assert.strictEqual(state.logs.length, 1);
    assert.strictEqual(state.logs[0].result, "unauthorized");
    assert.strictEqual(state.logs[0].authorized, false);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
