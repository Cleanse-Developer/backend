const { checkServiceability } = require("./shiprocket.service");
const { getConfig: getShiprocketConfig } = require("../utils/shiprocketConfig");

/**
 * Dynamic delivery charges from Shiprocket.
 *
 * Only used when the admin switches Shipping > Charge mode to "dynamic"
 * (utils/shippingChargeMode). Everything here is built so that a customer is
 * never charged a number we are not sure about: any failure, simulated answer
 * (Shiprocket test mode) or missing data returns null and the caller falls back
 * to the static admin rates.
 */

// A quote is cached so the price shown in the cart is the price charged at
// payment a few minutes later (Shiprocket rates can move between two calls).
const QUOTE_TTL_MS = 15 * 60 * 1000;
// A failed lookup is remembered briefly so a Shiprocket outage (or someone
// hammering the public pricing endpoint with random pincodes) does not turn
// into one upstream call per request.
const FAILURE_TTL_MS = 60 * 1000;
const LOOKUP_TIMEOUT_MS = 4000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map(); // key -> { at, value }  (value null = failed lookup)
const inflight = new Map(); // key -> Promise (concurrent callers share one call)

const validRate = (c) => Number.isFinite(Number(c?.rate)) && Number(c.rate) >= 0;
const days = (c) => (Number(c?.estimatedDays) > 0 ? Number(c.estimatedDays) : Infinity);

const cheapest = (list) =>
  list.reduce((a, b) => {
    const ra = Number(a.rate);
    const rb = Number(b.rate);
    if (ra !== rb) return ra < rb ? a : b;
    return days(a) <= days(b) ? a : b; // tie: the faster one
  });

const fastest = (list) =>
  list.reduce((a, b) => {
    const da = days(a);
    const db = days(b);
    if (da !== db) return da < db ? a : b;
    return Number(a.rate) <= Number(b.rate) ? a : b; // tie: the cheaper one
  });

/**
 * Choose the courier whose rate the customer is quoted.
 *   "ours"     the courier we book with (defaultCourierId) if it can serve this
 *              pincode, else Shiprocket's recommended courier, else the cheapest
 *   "cheapest" lowest rate
 *   "fastest"  shortest delivery time
 * Returns { courier, via } or null when there is no usable courier.
 */
const pickCourier = (couriers, rule, { defaultCourierId, recommendedCourierId } = {}) => {
  const list = (Array.isArray(couriers) ? couriers : []).filter(validRate);
  if (!list.length) return null;

  if (rule === "cheapest") return { courier: cheapest(list), via: "cheapest" };
  if (rule === "fastest") return { courier: fastest(list), via: "fastest" };

  const byId = (id) =>
    id !== undefined && id !== null && id !== ""
      ? list.find((c) => String(c.courierId) === String(id))
      : null;

  const ours = byId(defaultCourierId);
  if (ours) return { courier: ours, via: "default" };
  const rec = byId(recommendedCourierId);
  if (rec) return { courier: rec, via: "recommended" };
  return { courier: cheapest(list), via: "cheapest" };
};

/** Customer charge for a Shiprocket rate: add the admin adjustment, round, clamp to [0, cap]. */
const computeCharge = (rate, { adjustment = 0, cap = null } = {}) => {
  let charge = Math.round(Number(rate) + Number(adjustment || 0));
  if (!Number.isFinite(charge)) return null;
  if (cap !== null && cap !== undefined && Number.isFinite(Number(cap))) {
    charge = Math.min(charge, Number(cap));
  }
  return Math.max(0, charge);
};

/**
 * The order value at/above which delivery is free.
 * Static mode always uses the per-method / per-zone amount (existing behaviour).
 * In dynamic mode the admin can keep it, set one custom amount, or turn it off.
 */
const resolveFreeAbove = (chargeMode, staticFreeAbove) => {
  if (chargeMode?.mode !== "dynamic") return staticFreeAbove;
  const ft = chargeMode.freeThreshold || {};
  if (ft.mode === "off") return Infinity;
  if (ft.mode === "custom" && Number(ft.amount) > 0) return Number(ft.amount);
  return staticFreeAbove;
};

const remember = (key, value) => {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
};

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Shiprocket rate lookup timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Live courier list for a lane, cached. Resolves to
 * { couriers, recommendedCourierId } or null (failure, simulated, or no couriers).
 */
const fetchCouriers = async ({ pickupPincode, pincode, weight, cod }) => {
  const key = `${pickupPincode}|${pincode}|${weight}|${cod}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? QUOTE_TTL_MS : FAILURE_TTL_MS)) {
    return hit.value;
  }
  if (inflight.has(key)) return inflight.get(key);

  const lookup = (async () => {
    try {
      const r = await withTimeout(checkServiceability(pincode, weight, cod), LOOKUP_TIMEOUT_MS);
      // Only a real Shiprocket answer is priced. "test" (simulated couriers) and
      // "fallback" (API failed, no rates) must never reach a customer's bill.
      const usable =
        r && r.source === "shiprocket" && Array.isArray(r.couriers) && r.couriers.length > 0;
      const value = usable
        ? { couriers: r.couriers, recommendedCourierId: r.recommendedCourierId ?? null }
        : null;
      remember(key, value);
      return value;
    } catch {
      remember(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, lookup);
  return lookup;
};

/**
 * Quote the delivery charge for one destination.
 * @param {{ pincode: string, method: string, config: object }} args
 *   method: "cod" quotes the COD rate (includes Shiprocket's COD fee); anything
 *   else is prepaid. config: the normalized utils/shippingChargeMode config.
 * @returns {Promise<null | { charge, rate, courierId, courierName, etaDays, via }>}
 */
const quoteShiprocketCharge = async ({ pincode, method, config }) => {
  const pin = String(pincode || "").trim();
  if (!/^\d{6}$/.test(pin)) return null;

  const sr = await getShiprocketConfig();
  // Same package weight used when we book the shipment, so the quote matches the bill.
  const weight = Number(sr.pkg?.weight) > 0 ? Number(sr.pkg.weight) : 0.5;
  const cod = method === "cod" ? 1 : 0;

  const data = await fetchCouriers({
    pickupPincode: sr.pickupPincode,
    pincode: pin,
    weight,
    cod,
  });
  if (!data) return null;

  const picked = pickCourier(data.couriers, config?.courierRule, {
    defaultCourierId: sr.defaultCourierId,
    recommendedCourierId: data.recommendedCourierId,
  });
  if (!picked) return null;

  const charge = computeCharge(picked.courier.rate, config);
  if (charge === null) return null;

  return {
    charge,
    rate: Number(picked.courier.rate),
    courierId: picked.courier.courierId,
    courierName: picked.courier.name,
    etaDays: Number(picked.courier.estimatedDays) > 0 ? Number(picked.courier.estimatedDays) : null,
    via: picked.via,
  };
};

module.exports = {
  quoteShiprocketCharge,
  pickCourier,
  computeCharge,
  resolveFreeAbove,
  // exposed for tests
  _cache: cache,
  _inflight: inflight,
};
