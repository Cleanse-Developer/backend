const ApiError = require("../utils/ApiError");

const DEFAULT_VERIFY_URL =
  "https://control.msg91.com/api/v5/widget/verifyAccessToken";

/**
 * Server-side verification of an MSG91 OTP-widget access-token.
 *
 * The widget verifies the OTP on the client and hands back a short-lived,
 * single-use access-token (JWT). This re-checks that token against MSG91 so the
 * backend never trusts the client alone, and returns the VERIFIED identifier
 * (e.g. "919179621765") which the caller turns into a local number.
 *
 * NOTE: Currently NOT called — the controller uses a temporary happy-path while
 * the MSG91 account AuthKey is unavailable. Wire it up by setting MSG91_AUTHKEY
 * and calling this from verifyWidgetToken (see auth.controller.js).
 *
 * @param {string} accessToken access-token returned by the widget
 * @returns {Promise<string>} the verified identifier (mobile/email)
 */
const verifyAccessToken = async (accessToken) => {
  const authkey = process.env.MSG91_AUTHKEY;
  const verifyUrl = process.env.MSG91_VERIFY_URL || DEFAULT_VERIFY_URL;

  if (!authkey) {
    throw ApiError.internal("MSG91 is not configured");
  }

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authkey, "access-token": accessToken }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Never log the JWT or authkey; truncate the body.
    console.error(`[MSG91] verifyAccessToken failed: ${res.status} - ${errText.slice(0, 200)}`);
    throw ApiError.unauthorized("OTP verification failed");
  }

  const data = await res.json();

  // MSG91 returns { type: "success", message: "<verified identifier>" }.
  if (data.type && data.type !== "success") {
    console.error(`[MSG91] verifyAccessToken rejected: ${String(data.message).slice(0, 200)}`);
    throw ApiError.unauthorized("OTP verification failed");
  }

  const identifier = data.message || data.data || data.mobile;
  if (!identifier) {
    throw ApiError.unauthorized("OTP verification failed");
  }

  return String(identifier);
};

module.exports = { verifyAccessToken };
