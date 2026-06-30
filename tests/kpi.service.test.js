// Unit tests for kpi.service pure helpers (resolveRange, compare).
// No DB needed. Run: node tests/kpi.service.test.js
const assert = require("assert");
const { resolveRange, compare } = require("../src/services/kpi.service");

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const DAY = 86400000;

// ── resolveRange ─────────────────────────────────────────────────────────────

t("explicit range → equal-length previous window ending at current start", () => {
  const r = resolveRange({ dateFrom: "2026-06-01", dateTo: "2026-06-11" });
  assert.strictEqual(r.from.toISOString().slice(0, 10), "2026-06-01");
  assert.strictEqual(r.to.toISOString().slice(0, 10), "2026-06-11");
  // previous window = 10 days immediately before `from`
  assert.strictEqual(r.prevTo.getTime(), r.from.getTime());
  assert.strictEqual(r.prevFrom.getTime(), r.from.getTime() - 10 * DAY);
});

t("groupBy auto: <=31d → day, <=180d → week, else month", () => {
  assert.strictEqual(resolveRange({ dateFrom: "2026-06-01", dateTo: "2026-06-20" }).groupBy, "day");
  assert.strictEqual(resolveRange({ dateFrom: "2026-01-01", dateTo: "2026-04-01" }).groupBy, "week");
  assert.strictEqual(resolveRange({ dateFrom: "2025-01-01", dateTo: "2026-01-01" }).groupBy, "month");
});

t("explicit groupBy overrides auto", () => {
  assert.strictEqual(
    resolveRange({ dateFrom: "2026-06-01", dateTo: "2026-06-20", groupBy: "month" }).groupBy,
    "month"
  );
});

t("invalid groupBy falls back to auto", () => {
  assert.strictEqual(
    resolveRange({ dateFrom: "2026-06-01", dateTo: "2026-06-05", groupBy: "decade" }).groupBy,
    "day"
  );
});

t("no dateFrom → defaults to start of the to-month", () => {
  const r = resolveRange({ dateTo: "2026-06-15" });
  assert.strictEqual(r.from.getDate(), 1);
  assert.strictEqual(r.from.getMonth(), 5); // June (0-indexed)
});

// ── compare ──────────────────────────────────────────────────────────────────

t("compare: positive growth", () => {
  const c = compare(150, 100);
  assert.strictEqual(c.value, 150);
  assert.strictEqual(c.previous, 100);
  assert.strictEqual(c.deltaPct, 50);
  assert.strictEqual(c.direction, "up");
});

t("compare: decline", () => {
  const c = compare(80, 100);
  assert.strictEqual(c.deltaPct, -20);
  assert.strictEqual(c.direction, "down");
});

t("compare: previous zero → deltaPct null, direction up when value>0", () => {
  const c = compare(50, 0);
  assert.strictEqual(c.deltaPct, null);
  assert.strictEqual(c.direction, "up");
});

t("compare: both zero → flat", () => {
  const c = compare(0, 0);
  assert.strictEqual(c.deltaPct, null);
  assert.strictEqual(c.direction, "flat");
});

t("compare: coerces nullish to 0", () => {
  const c = compare(undefined, null);
  assert.strictEqual(c.value, 0);
  assert.strictEqual(c.previous, 0);
  assert.strictEqual(c.direction, "flat");
});

console.log(`\n${passed} passed`);
