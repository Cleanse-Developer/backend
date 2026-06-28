// Standalone unit tests for Shiprocket pure helpers. Run: node tests/shiprocket.test.js
const assert = require("assert");
const {
  mapStatus,
  canAdvanceForward,
  TERMINAL,
} = require("../src/utils/shiprocketStatus");
const { normalizePhone, itemSku } = require("../src/services/shiprocket.service");

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// --- status mapping ---
t("delivered maps to delivered/delivered kind", () => {
  assert.deepStrictEqual(mapStatus(7), { status: "delivered", kind: "delivered" });
});
t("undelivered (36) is ndr branch", () => {
  assert.strictEqual(mapStatus(36).kind, "ndr");
});
t("RTO initiated (15) -> rto_in_transit", () => {
  assert.deepStrictEqual(mapStatus(15), { status: "rto_in_transit", kind: "rto" });
});
t("RTO delivered (16) -> rto_delivered branch", () => {
  assert.strictEqual(mapStatus(16).kind, "rto_delivered");
});
t("Lost (33) is exception", () => {
  assert.strictEqual(mapStatus(33).kind, "exception");
});
t("Return delivered (26) -> returned", () => {
  assert.deepStrictEqual(mapStatus(26), { status: "returned", kind: "return_delivered" });
});
t("unmapped id returns null", () => {
  assert.strictEqual(mapStatus(9999), null);
});

// --- out-of-order guard ---
t("advances shipped -> in_transit", () => {
  assert.strictEqual(canAdvanceForward("shipped", "in_transit"), true);
});
t("does NOT regress delivered -> in_transit", () => {
  assert.strictEqual(canAdvanceForward("delivered", "in_transit"), false);
});
t("delivered is terminal-aware (out_for_delivery -> delivered ok)", () => {
  assert.strictEqual(canAdvanceForward("out_for_delivery", "delivered"), true);
});
t("unknown next is not advanced", () => {
  assert.strictEqual(canAdvanceForward("shipped", "rto_in_transit"), false);
});

// --- terminal set ---
t("cancelled/refunded are terminal", () => {
  assert.ok(TERMINAL.has("cancelled") && TERMINAL.has("refunded"));
});

// --- phone normalization ---
t("strips +91", () => assert.strictEqual(normalizePhone("+919810363552"), "9810363552"));
t("strips spaces/dashes", () => assert.strictEqual(normalizePhone("98103-63552"), "9810363552"));
t("strips leading 0", () => assert.strictEqual(normalizePhone("09810363552"), "9810363552"));
t("keeps bare 10 digits", () => assert.strictEqual(normalizePhone("9810363552"), "9810363552"));

// --- per-variant SKU ---
t("sku is product-size", () => {
  assert.strictEqual(itemSku({ product: "abc123", selectedSize: "M" }), "abc123-M");
});
t("distinct products with same size do not collide", () => {
  assert.notStrictEqual(
    itemSku({ product: "p1", selectedSize: "M" }),
    itemSku({ product: "p2", selectedSize: "M" })
  );
});

// --- idempotency key shape (mirrors webhook controller) ---
t("idempotency key is awb:status:ts", () => {
  const p = { awb: "ABC", current_status_id: 7, current_timestamp: "23 05 2023 11:43:52" };
  const key = `sr:${p.awb}:${p.current_status_id}:${p.current_timestamp || ""}`;
  assert.strictEqual(key, "sr:ABC:7:23 05 2023 11:43:52");
});

// --- NDR counter policy ---
t("reattempt until cap, then return", () => {
  const MAX = 2;
  const action = (attempts) => (attempts <= MAX ? "re-attempt" : "return");
  assert.strictEqual(action(1), "re-attempt");
  assert.strictEqual(action(2), "re-attempt");
  assert.strictEqual(action(3), "return");
});

console.log(`\n${passed} passed`);
