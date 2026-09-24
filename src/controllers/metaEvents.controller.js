const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { relayBrowserEvents, browserContext, isEnabled } = require("../services/metaCapi.service");

/**
 * POST /api/ev — storefront relay for Meta Conversions API.
 *
 * The storefront posts with navigator.sendBeacon (text/plain, so no CORS
 * preflight and it survives page unloads). Because a beacon can't carry an
 * Authorization header, a signed-in shopper's access token rides in the body
 * as `t`. Body: { t?, tracking: { fbp, fbc, clientId }, events: [...] }.
 *
 * Always answers 204 quickly; the Meta call happens after the response.
 */
const relayEvents = async (req, res) => {
  res.status(204).end();
  if (!isEnabled()) return;

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return;
    }
  }
  if (!body || !Array.isArray(body.events)) return;

  let user = null;
  if (typeof body.t === "string" && body.t) {
    try {
      const decoded = jwt.verify(body.t, process.env.JWT_ACCESS_SECRET);
      const found = await User.findById(decoded.id).select("fullName email phone countryCode status").lean();
      if (found && found.status === "active") user = found;
    } catch {
      // expired/invalid token: send as a guest
    }
  }

  try {
    await relayBrowserEvents(body.events, { user, browser: browserContext(req, body.tracking) });
  } catch (err) {
    console.error("[MetaCAPI] relay failed:", err.message);
  }
};

module.exports = { relayEvents };
