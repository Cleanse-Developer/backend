/**
 * Phone number utilities.
 * India (+91) is the default country.
 *
 * Storage convention:
 *   - `phone` field      : local number only, no country code  (e.g. "9179621765")
 *   - `countryCode` field: dialling code with leading +         (e.g. "+91")
 *
 * This keeps searches simple (exact match on 10 digits) and avoids the
 * regex hacks that arise when some documents store "+919179621765" and
 * others store "9179621765".
 */

const DEFAULT_COUNTRY_CODE = "+91";

/**
 * Strip all formatting and extract the bare local number.
 * Removes +91 / 0091 / 91 prefixes for Indian numbers.
 *
 * Examples:
 *   "+91 917-962-1765" → "9179621765"
 *   "009191…"         → stripped
 *   "91XXXXXXXXXX"    → 10-digit local
 *   "9179621765"      → "9179621765"  (unchanged)
 */
function extractLocalNumber(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/[\s\-().]/g, "");
  let digits;
  if (s.startsWith("+91")) digits = s.slice(3);
  else if (s.startsWith("0091")) digits = s.slice(4);
  else digits = s;
  digits = digits.replace(/\D/g, "");
  // Indian local numbers are 10 digits. Strip any leftover/duplicated leading
  // country code (e.g. "919179621765" or "9191..." from a double-prefix).
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

/**
 * Parse a raw phone input into { countryCode, number }.
 * Defaults to DEFAULT_COUNTRY_CODE if no country code is detected.
 *
 * Examples:
 *   "+919179621765"  → { countryCode: "+91", number: "9179621765" }
 *   "9179621765"     → { countryCode: "+91", number: "9179621765" }
 *   "+447700900123"  → { countryCode: "+44", number: "7700900123" }
 */
function parsePhone(raw, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
  if (!raw) return null;
  const s = String(raw).replace(/[\s\-().]/g, "");

  if (s.startsWith("+")) {
    // Check +91 first — prevent greedy \d{1,3} from consuming "919" instead of
    // "91". Take the last 10 digits so a double-prefixed "+91919..." normalizes
    // to the real local number instead of eating a digit.
    if (s.startsWith("+91")) {
      let n = s.slice(3).replace(/\D/g, "");
      if (n.length > 10) n = n.slice(-10);
      return { countryCode: "+91", number: n };
    }
    const match = s.match(/^\+(\d{1,3})(\d+)$/);
    if (match) return { countryCode: "+" + match[1], number: match[2] };
  }
  if (s.startsWith("0091") && s.length >= 14) {
    return { countryCode: "+91", number: s.slice(4) };
  }
  if (/^91\d{10}$/.test(s)) {
    return { countryCode: "+91", number: s.slice(2) };
  }
  return { countryCode: defaultCountryCode, number: s.replace(/\D/g, "") };
}

/**
 * Validate a raw phone input.
 *
 * India (default, or countryCode "+91") keeps the strict rule: exactly 10
 * digits starting with 6–9. Any other dialling code accepts a general
 * international number of 6–15 digits (E.164 range).
 *
 * The default keeps every existing caller (auth/OTP, user profile) India-strict
 * unless they explicitly pass a non-India countryCode.
 */
function isValidPhone(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  const cc = (countryCode || DEFAULT_COUNTRY_CODE).trim();
  if (cc === DEFAULT_COUNTRY_CODE) {
    const local = extractLocalNumber(raw);
    return /^[6-9]\d{9}$/.test(local);
  }
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * Return the full E.164 representation: countryCode + localNumber
 * e.g. "+919179621765"
 */
function normalizePhone(raw, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
  const parsed = parsePhone(raw, defaultCountryCode);
  if (!parsed) return null;
  return parsed.countryCode + parsed.number;
}

module.exports = {
  parsePhone,
  extractLocalNumber,
  normalizePhone,
  isValidPhone,
  DEFAULT_COUNTRY_CODE,
};
