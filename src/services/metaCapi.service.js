/**
 * Meta Conversions API (server-side events).
 *
 * The browser pixel loses events to ad blockers, iOS/Safari tracking limits and
 * closed tabs. This service sends the same events from the server, so Meta
 * still receives them. Every event carries the event_id the browser pixel used,
 * which lets Meta keep one copy when both arrive.
 *
 * Sources:
 *   - Browser relay (POST /api/ev): PageView, ViewContent, AddToCart,
 *     InitiateCheckout, AddPaymentInfo. The server adds IP / user agent and,
 *     when the shopper is signed in, their account details.
 *   - Server only: Purchase, fired once an order exists (COD placement and
 *     every Razorpay path). event_id is `purchase_<orderId>`, the same id the
 *     storefront pixel uses, so the two are deduplicated.
 *
 * Config (all optional; with no access token every call is a silent no-op):
 *   META_PIXEL_ID            dataset / pixel id (default: the storefront pixel)
 *   META_CAPI_ACCESS_TOKEN   Events Manager > Settings > Conversions API > Generate access token
 *   META_CAPI_TEST_CODE      Test Events code (TEST12345), only while testing
 *   META_GRAPH_VERSION       Graph API version (default v23.0)
 */
const crypto = require("crypto");

const PIXEL_ID = process.env.META_PIXEL_ID || "662202292509283";
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || "";
const TEST_CODE = process.env.META_CAPI_TEST_CODE || "";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const SITE_URL = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const CURRENCY = "INR";
const TIMEOUT_MS = 5000;

const isEnabled = () => Boolean(ACCESS_TOKEN && PIXEL_ID);

// ── Hashing / normalization (Meta's customer-information rules) ──

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function hashed(value, normalize = (v) => v.trim().toLowerCase()) {
  if (value === undefined || value === null) return undefined;
  const v = normalize(String(value));
  return v ? sha256(v) : undefined;
}

// Digits only, with country code ("919876543210").
function normalizePhone(phone, countryCode = "+91") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const cc = String(countryCode || "").replace(/\D/g, "");
  if (digits.length > 10 && cc && digits.startsWith(cc)) return digits;
  return `${cc}${digits}`;
}

const lettersOnly = (v) => v.toLowerCase().replace(/[^a-z]/g, "");

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : undefined };
}

// ISO-3166 alpha-2 for the countries we ship to most; Meta wants 2 letters.
function countryCode(country) {
  const c = String(country || "").trim().toLowerCase();
  if (!c) return undefined;
  if (c.length === 2) return c;
  const map = { india: "in", "united states": "us", usa: "us", "united kingdom": "gb", uk: "gb", "united arab emirates": "ae", uae: "ae", canada: "ca", australia: "au", singapore: "sg" };
  return map[c];
}

const compact = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/**
 * Build Meta user_data.
 * @param {object} p
 * @param {object} [p.user]     User document (fullName, email, phone, countryCode, _id)
 * @param {object} [p.address]  Shipping address (fullName, email, phone, countryCode, city, state, pincode, country)
 * @param {object} [p.browser]  { ip, userAgent, fbp, fbc, clientId }
 */
function buildUserData({ user, address, browser } = {}) {
  const email = user?.email || address?.email;
  const phoneRaw = user?.phone || address?.phone;
  const cc = user?.phone ? user?.countryCode : address?.countryCode;
  const { first, last } = splitName(user?.fullName || address?.fullName);
  // external_id matches what the browser pixel sends (the raw user id; the
  // pixel hashes it the same way). Guests fall back to the storefront client id.
  const externalId = user?._id ? String(user._id) : browser?.clientId;

  return compact({
    em: email ? [hashed(email)] : undefined,
    ph: phoneRaw ? [hashed(normalizePhone(phoneRaw, cc || "+91"), (v) => v)] : undefined,
    fn: first ? [hashed(first, lettersOnly)] : undefined,
    ln: last ? [hashed(last, lettersOnly)] : undefined,
    ct: address?.city ? [hashed(address.city, lettersOnly)] : undefined,
    st: address?.state ? [hashed(address.state, lettersOnly)] : undefined,
    zp: address?.pincode ? [hashed(address.pincode, (v) => v.replace(/\s/g, "").toLowerCase())] : undefined,
    country: countryCode(address?.country) ? [hashed(countryCode(address.country))] : undefined,
    external_id: externalId ? [hashed(externalId, (v) => v.trim())] : undefined,
    client_ip_address: browser?.ip || undefined,
    client_user_agent: browser?.userAgent || undefined,
    fbp: browser?.fbp || undefined,
    fbc: browser?.fbc || undefined,
  });
}

// ── Transport ──

async function post(events) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`;
  const body = { data: events, access_token: ACCESS_TOKEN };
  if (TEST_CODE) body.test_event_code = TEST_CODE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[MetaCAPI] ${res.status} for ${events.map((e) => e.event_name).join(",")}:`, json?.error?.message || json);
      return null;
    }
    return json;
  } catch (err) {
    console.error("[MetaCAPI] send failed:", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send events. Never throws: tracking must not break checkout.
 * @param {Array<object>} events  Server events (event_name, event_id, event_time, ...)
 */
async function sendEvents(events) {
  if (!isEnabled() || !events?.length) return null;
  return post(events);
}

// ── Events ──

// Browser relay. `events` come from the storefront; only whitelisted names are
// accepted (Purchase is server-only so it can't be faked from a browser).
const RELAY_EVENTS = new Set(["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]);

function sanitizeCustomData(cd) {
  if (!cd || typeof cd !== "object") return undefined;
  const out = {};
  if (Number.isFinite(Number(cd.value))) out.value = Number(cd.value);
  if (typeof cd.currency === "string") out.currency = cd.currency.slice(0, 3).toUpperCase();
  if (Array.isArray(cd.content_ids)) out.content_ids = cd.content_ids.slice(0, 50).map((id) => String(id).slice(0, 100));
  if (typeof cd.content_type === "string") out.content_type = cd.content_type.slice(0, 20);
  if (typeof cd.content_name === "string") out.content_name = cd.content_name.slice(0, 200);
  if (typeof cd.content_category === "string") out.content_category = cd.content_category.slice(0, 100);
  if (Number.isFinite(Number(cd.num_items))) out.num_items = Number(cd.num_items);
  if (Array.isArray(cd.contents)) {
    out.contents = cd.contents.slice(0, 50).map((c) =>
      compact({
        id: c?.id !== undefined ? String(c.id).slice(0, 100) : undefined,
        quantity: Number.isFinite(Number(c?.quantity)) ? Number(c.quantity) : undefined,
        item_price: Number.isFinite(Number(c?.item_price)) ? Number(c.item_price) : undefined,
      })
    );
  }
  if (typeof cd.session_id === "string") out.session_id = cd.session_id.slice(0, 64);
  if (typeof cd.payment_method === "string") out.payment_method = cd.payment_method.slice(0, 30);
  return Object.keys(out).length ? out : undefined;
}

// Only http(s) URLs are passed through as event_source_url.
function safeSourceUrl(url) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return u.toString().slice(0, 1000);
  } catch {
    return undefined;
  }
}

/**
 * Relay browser events. Returns the number accepted.
 * @param {Array} rawEvents  [{ event_name, event_id, event_time, event_source_url, custom_data }]
 * @param {object} ctx       { user, browser }
 */
async function relayBrowserEvents(rawEvents, { user, browser } = {}) {
  if (!Array.isArray(rawEvents)) return 0;
  const now = Math.floor(Date.now() / 1000);
  const userData = buildUserData({ user, browser });
  const events = rawEvents
    .slice(0, 20)
    .filter((e) => e && RELAY_EVENTS.has(e.event_name) && typeof e.event_id === "string")
    .map((e) => {
      // Meta rejects events older than 7 days or in the future; clamp to now
      // when the browser clock is off.
      const t = Number(e.event_time);
      const eventTime = Number.isFinite(t) && t <= now + 60 && t > now - 7 * 86400 ? Math.floor(t) : now;
      return compact({
        event_name: e.event_name,
        event_id: e.event_id.slice(0, 100),
        event_time: eventTime,
        action_source: "website",
        event_source_url: safeSourceUrl(e.event_source_url),
        user_data: userData,
        custom_data: sanitizeCustomData({ session_id: browser?.sessionId, ...e.custom_data }),
      });
    });
  if (!events.length) return 0;
  await sendEvents(events);
  return events.length;
}

/**
 * Server-side Purchase for a created order. Best-effort; never throws.
 * @param {object} order   Order document
 * @param {object} [ctx]   { user, browser } (browser: ip, userAgent, fbp, fbc, clientId, sourceUrl)
 */
async function sendPurchase(order, { user, browser } = {}) {
  try {
    if (!isEnabled() || !order?.orderId) return null;
    const items = (order.items || []).filter((i) => !i.isFreeGift);
    const contents = items.map((i) => ({
      id: String(i.product?._id || i.product),
      quantity: i.quantity,
      item_price: i.price,
    }));
    const event = compact({
      event_name: "Purchase",
      event_id: `purchase_${order.orderId}`,
      event_time: Math.floor(new Date(order.createdAt || Date.now()).getTime() / 1000),
      action_source: "website",
      event_source_url: safeSourceUrl(browser?.sourceUrl) || (SITE_URL ? `${SITE_URL}/checkout` : undefined),
      user_data: buildUserData({ user, address: order.shippingAddress, browser }),
      custom_data: compact({
        currency: CURRENCY,
        value: Number(order.pricing?.total) || 0,
        order_id: order.orderId,
        content_type: "product",
        content_ids: contents.map((c) => c.id),
        contents,
        num_items: contents.reduce((n, c) => n + (c.quantity || 0), 0),
        payment_method: order.payment?.method,
        // Same session id the browser attaches to every pixel event.
        session_id: browser?.sessionId,
      }),
    });
    return await sendEvents([event]);
  } catch (err) {
    console.error(`[MetaCAPI] purchase ${order?.orderId} failed:`, err.message);
    return null;
  }
}

// ── Request helpers ──

// Real client IP. Behind CloudFront the first X-Forwarded-For hop is the
// viewer; CloudFront-Viewer-Address (if forwarded) is the most reliable.
function clientIp(req) {
  const viewer = req.headers["cloudfront-viewer-address"];
  if (viewer) return String(viewer).replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.ip;
}

const COOKIE_RE = /^fb\.\d\.\d+\.[\w.-]+$/;

/**
 * Browser identifiers from a request. `tracking` is the body field the
 * storefront sends ({ fbp, fbc, clientId, sourceUrl }); cookies can't be used
 * because the API lives on a different domain than the storefront.
 */
function browserContext(req, tracking = req.body?.tracking) {
  const t = tracking && typeof tracking === "object" ? tracking : {};
  return compact({
    ip: clientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    fbp: typeof t.fbp === "string" && COOKIE_RE.test(t.fbp) ? t.fbp : undefined,
    fbc: typeof t.fbc === "string" && COOKIE_RE.test(t.fbc) ? t.fbc : undefined,
    clientId: typeof t.clientId === "string" ? t.clientId.slice(0, 64) : undefined,
    sessionId: typeof t.sessionId === "string" ? t.sessionId.slice(0, 64) : undefined,
    sourceUrl: typeof t.sourceUrl === "string" ? t.sourceUrl.slice(0, 1000) : undefined,
  });
}

module.exports = {
  isEnabled,
  sendEvents,
  relayBrowserEvents,
  sendPurchase,
  browserContext,
  buildUserData,
  _internal: { normalizePhone, hashed, sanitizeCustomData, RELAY_EVENTS },
};
