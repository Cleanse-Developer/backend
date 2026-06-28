const Settings = require("../models/Settings");

const KEY = "shiprocket_mode";
const DEFAULT = "live";
const CACHE_TTL_MS = 30 * 1000;

let cached = null;
let cacheAt = 0;

/**
 * Current Shiprocket mode: "live" (real API calls) or "test" (simulated, no
 * real shipments/charges). Stored in the Settings collection so admins can
 * toggle it at runtime — no redeploy. Cached 30s to avoid a DB read per call.
 */
const getMode = async () => {
  if (cached && Date.now() - cacheAt < CACHE_TTL_MS) return cached;
  try {
    const doc = await Settings.findOne({ key: KEY }).lean();
    cached = doc?.value === "test" ? "test" : "live";
  } catch {
    cached = DEFAULT; // fail safe to live
  }
  cacheAt = Date.now();
  return cached;
};

const isTestMode = async () => (await getMode()) === "test";

const setMode = async (mode) => {
  const value = mode === "test" ? "test" : "live";
  await Settings.updateOne({ key: KEY }, { $set: { key: KEY, value } }, { upsert: true });
  cached = value;
  cacheAt = Date.now();
  return value;
};

const invalidate = () => {
  cached = null;
  cacheAt = 0;
};

module.exports = { getMode, isTestMode, setMode, invalidate, KEY, DEFAULT };
