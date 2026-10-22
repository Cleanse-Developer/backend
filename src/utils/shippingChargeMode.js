const Settings = require("../models/Settings");
const ApiError = require("./ApiError");

const KEY = "shipping_charge_mode";
const CACHE_TTL_MS = 30 * 1000;

const MODES = ["static", "dynamic"];
// "ours": the courier we actually book with (Shiprocket config defaultCourierId),
// else Shiprocket's recommended courier, else the cheapest.
const COURIER_RULES = ["ours", "cheapest", "fastest"];
// How "free delivery above ₹X" behaves in dynamic mode:
//   static: keep the per-method / per-zone amounts from the Shipping tab (default)
//   custom: one amount that applies to every order
//   off:    never free, always charge the live rate
const FREE_MODES = ["static", "custom", "off"];

const DEFAULTS = Object.freeze({
  mode: "static",
  courierRule: "ours",
  freeThreshold: Object.freeze({ mode: "static", amount: 0 }),
  adjustment: 0,
  cap: null,
});

const isFiniteNum = (v) =>
  v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v));

/**
 * Lenient read: turns whatever is stored into a safe config. Anything missing or
 * malformed falls back to the default, so a bad document can never break pricing.
 */
const normalize = (raw) => {
  const r = raw && typeof raw === "object" ? raw : {};
  const ft = r.freeThreshold && typeof r.freeThreshold === "object" ? r.freeThreshold : {};

  let freeMode = FREE_MODES.includes(ft.mode) ? ft.mode : "static";
  const amount = isFiniteNum(ft.amount) && Number(ft.amount) > 0 ? Number(ft.amount) : 0;
  // A "custom" threshold of 0 would make every order free: treat it as unset.
  if (freeMode === "custom" && amount <= 0) freeMode = "static";

  return {
    mode: r.mode === "dynamic" ? "dynamic" : "static",
    courierRule: COURIER_RULES.includes(r.courierRule) ? r.courierRule : DEFAULTS.courierRule,
    freeThreshold: { mode: freeMode, amount },
    adjustment: isFiniteNum(r.adjustment) ? Number(r.adjustment) : 0,
    cap: isFiniteNum(r.cap) && Number(r.cap) >= 0 ? Number(r.cap) : null,
  };
};

/**
 * Strict check for admin input. Throws a 400 naming the bad field instead of
 * silently correcting it, so the admin sees the mistake.
 */
const validate = (input) => {
  const r = input && typeof input === "object" ? input : {};
  const ft = r.freeThreshold && typeof r.freeThreshold === "object" ? r.freeThreshold : {};

  if (!MODES.includes(r.mode)) {
    throw ApiError.badRequest('mode must be "static" or "dynamic"');
  }
  if (!COURIER_RULES.includes(r.courierRule)) {
    throw ApiError.badRequest(`courierRule must be one of: ${COURIER_RULES.join(", ")}`);
  }
  if (!FREE_MODES.includes(ft.mode)) {
    throw ApiError.badRequest(`freeThreshold.mode must be one of: ${FREE_MODES.join(", ")}`);
  }
  if (ft.mode === "custom" && !(isFiniteNum(ft.amount) && Number(ft.amount) > 0)) {
    throw ApiError.badRequest("freeThreshold.amount must be greater than 0 for a custom threshold");
  }
  if (r.adjustment !== undefined && r.adjustment !== "" && !isFiniteNum(r.adjustment)) {
    throw ApiError.badRequest("adjustment must be a number (₹, may be negative)");
  }
  const hasCap = r.cap !== undefined && r.cap !== null && r.cap !== "";
  if (hasCap && !(isFiniteNum(r.cap) && Number(r.cap) >= 0)) {
    throw ApiError.badRequest("cap must be a number of 0 or more (leave empty for no cap)");
  }
  return normalize(r);
};

let cached = null;
let cacheAt = 0;

/**
 * Current delivery-charge mode. "static" (default) = the admin rates from the
 * Shipping tab. "dynamic" = live Shiprocket rates with the static rates as a
 * fallback. Cached 30 s; fails safe to static if the DB read errors.
 */
const getConfig = async () => {
  if (cached && Date.now() - cacheAt < CACHE_TTL_MS) return cached;
  try {
    const doc = await Settings.findOne({ key: KEY }).lean();
    cached = normalize(doc?.value);
  } catch {
    cached = normalize(null);
  }
  cacheAt = Date.now();
  return cached;
};

const setConfig = async (input) => {
  const next = validate(input);
  await Settings.updateOne({ key: KEY }, { $set: { key: KEY, value: next } }, { upsert: true });
  cached = next;
  cacheAt = Date.now();
  return next;
};

const invalidate = () => {
  cached = null;
  cacheAt = 0;
};

module.exports = {
  KEY,
  MODES,
  COURIER_RULES,
  FREE_MODES,
  DEFAULTS,
  normalize,
  validate,
  getConfig,
  setConfig,
  invalidate,
};
