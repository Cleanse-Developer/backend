const Settings = require("../models/Settings");
const { GIFT_WRAP_COST } = require("./constants");

const CACHE_TTL_MS = 30 * 1000;

let cached = null;
let cacheAt = 0;

const asCost = (v) => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/**
 * Gift-wrap price. The admin edits it on the Shipping page, which saves the
 * setting `GIFT_WRAP_COST`; `gift_wrap_cost` is the older seeded key. The
 * constant is only the last-resort default. Cached 30 s; falls back on DB errors.
 */
const getGiftWrapCost = async () => {
  if (cached !== null && Date.now() - cacheAt < CACHE_TTL_MS) return cached;
  try {
    const docs = await Settings.find({ key: { $in: ["GIFT_WRAP_COST", "gift_wrap_cost"] } }).lean();
    const byKey = Object.fromEntries(docs.map((d) => [d.key, d.value]));
    cached = asCost(byKey.GIFT_WRAP_COST) ?? asCost(byKey.gift_wrap_cost) ?? GIFT_WRAP_COST;
  } catch {
    cached = GIFT_WRAP_COST;
  }
  cacheAt = Date.now();
  return cached;
};

const invalidate = () => {
  cached = null;
  cacheAt = 0;
};

module.exports = { getGiftWrapCost, invalidate };
