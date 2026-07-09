// Unit tests for promoter.service pure helpers (commission math).
// No DB needed. Run: node tests/promoter.service.test.js
const assert = require("assert");
const {
  computeBasisAmount,
  computeCommission,
} = require("../src/services/promoter.service");

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// ── computeBasisAmount: net merchandise = subtotal − all promo discounts ───────

t("basis = subtotal − bundle − tier − special − coupon", () => {
  const b = computeBasisAmount({
    subtotal: 1000,
    bundleDiscountTotal: 50,
    tierDiscount: 100,
    specialCouponDiscountTotal: 30,
    couponDiscount: 200,
  });
  assert.strictEqual(b, 620);
});

t("basis ignores shipping / gift wrap / loyalty (not passed as discounts)", () => {
  // Only the discount fields reduce the basis; shipping etc. never enter it.
  const b = computeBasisAmount({ subtotal: 1000, couponDiscount: 200 });
  assert.strictEqual(b, 800);
});

t("missing discount fields default to 0", () => {
  assert.strictEqual(computeBasisAmount({ subtotal: 500 }), 500);
});

t("basis floored at 0 when discounts exceed subtotal", () => {
  const b = computeBasisAmount({ subtotal: 300, couponDiscount: 500 });
  assert.strictEqual(b, 0);
});

t("empty/nullish pricing → 0", () => {
  assert.strictEqual(computeBasisAmount({}), 0);
  assert.strictEqual(computeBasisAmount(null || {}), 0);
});

// ── computeCommission: percentage / fixed, rounding, caps ──────────────────────

t("percentage commission, rounded to integer rupees", () => {
  assert.strictEqual(computeCommission({ type: "percentage", rate: 10 }, 750), 75);
  // 10% of 745 = 74.5 → Math.round → 75
  assert.strictEqual(computeCommission({ type: "percentage", rate: 10 }, 745), 75);
  // 10% of 744 = 74.4 → 74
  assert.strictEqual(computeCommission({ type: "percentage", rate: 10 }, 744), 74);
});

t("fixed_per_order commission is the flat rate", () => {
  assert.strictEqual(
    computeCommission({ type: "fixed_per_order", rate: 100 }, 750),
    100
  );
});

t("fixed_per_order never exceeds the basis", () => {
  assert.strictEqual(
    computeCommission({ type: "fixed_per_order", rate: 900 }, 750),
    750
  );
});

t("zero / negative basis → 0 commission", () => {
  assert.strictEqual(computeCommission({ type: "percentage", rate: 10 }, 0), 0);
  assert.strictEqual(computeCommission({ type: "percentage", rate: 10 }, -50), 0);
});

t("missing rate → 0", () => {
  assert.strictEqual(computeCommission({ type: "percentage" }, 750), 0);
});

console.log(`\n${passed} passed`);
