const Settings = require("../models/Settings");

const KEY = "shiprocket_config";
const CACHE_TTL_MS = 30 * 1000;

let cached = null;
let cacheAt = 0;

// Defaults from env (fallback when nothing saved in the admin CMS yet).
const envDefaults = () => ({
  pickupLocation: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",
  pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE || "110001",
  warehouse: {
    name: process.env.SHIPROCKET_PICKUP_NAME || "",
    address: process.env.SHIPROCKET_PICKUP_ADDRESS || "",
    city: process.env.SHIPROCKET_PICKUP_CITY || "",
    state: process.env.SHIPROCKET_PICKUP_STATE || "",
    phone: process.env.SHIPROCKET_PICKUP_PHONE || "",
  },
  defaultCourierId: process.env.SHIPROCKET_DEFAULT_COURIER_ID || "",
  ndrMaxReattempts: Number(process.env.SHIPROCKET_NDR_MAX_REATTEMPTS) || 2,
  pkg: {
    length: Number(process.env.SHIPROCKET_PKG_LENGTH) || 20,
    breadth: Number(process.env.SHIPROCKET_PKG_BREADTH) || 15,
    height: Number(process.env.SHIPROCKET_PKG_HEIGHT) || 10,
    weight: Number(process.env.SHIPROCKET_PKG_WEIGHT) || 0.5,
  },
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || "",
});

// Merge a saved (possibly partial) config doc over the env defaults.
const merge = (saved) => {
  const d = envDefaults();
  if (!saved || typeof saved !== "object") return d;
  return {
    pickupLocation: saved.pickupLocation || d.pickupLocation,
    pickupPincode: saved.pickupPincode || d.pickupPincode,
    warehouse: { ...d.warehouse, ...(saved.warehouse || {}) },
    defaultCourierId: saved.defaultCourierId ?? d.defaultCourierId,
    ndrMaxReattempts: Number(saved.ndrMaxReattempts) || d.ndrMaxReattempts,
    pkg: { ...d.pkg, ...(saved.pkg || {}) },
    adminNotifyEmail: saved.adminNotifyEmail || d.adminNotifyEmail,
  };
};

/**
 * Operational Shiprocket config (pickup, warehouse, courier, NDR, package,
 * alert email). Stored in the Settings collection (admin CMS), falling back to
 * env. Cached 30s. Credentials + webhook token stay in env (secrets).
 */
const getConfig = async () => {
  if (cached && Date.now() - cacheAt < CACHE_TTL_MS) return cached;
  try {
    const doc = await Settings.findOne({ key: KEY }).lean();
    cached = merge(doc?.value);
  } catch {
    cached = envDefaults();
  }
  cacheAt = Date.now();
  return cached;
};

const setConfig = async (partial) => {
  const current = await getConfig();
  const next = merge({ ...current, ...partial });
  await Settings.updateOne({ key: KEY }, { $set: { key: KEY, value: next } }, { upsert: true });
  cached = next;
  cacheAt = Date.now();
  return next;
};

const invalidate = () => {
  cached = null;
  cacheAt = 0;
};

module.exports = { getConfig, setConfig, invalidate, envDefaults, KEY };
