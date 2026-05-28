const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const randomCode = (prefix = "CLEANSE-", length = 6) => {
  let code = prefix;
  for (let i = 0; i < length; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return code;
};

/**
 * Generate a unique referral code, retrying on collision.
 * Falls back to a longer suffix on repeated collisions.
 *
 * @param {string} prefix - Prefix for the code (default "CLEANSE-")
 * @returns {Promise<string>} A referral code that does not exist on any user
 */
const generateReferralCode = async (prefix = "CLEANSE-") => {
  // Lazy require to avoid circular deps
  const User = require("../models/User");

  for (let attempt = 0; attempt < 10; attempt++) {
    // Use longer suffix after first 5 attempts
    const length = attempt < 5 ? 6 : 8;
    const code = randomCode(prefix, length);
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }

  throw new Error("Failed to generate a unique referral code after 10 attempts");
};

module.exports = generateReferralCode;
