const User = require("../models/User");

/**
 * Backfill a thin user profile from checkout shipping info on their first order.
 *
 * OTP-created accounts start as { fullName: "User", email: undefined } (there is
 * no register form). When they place their first order we opportunistically fill
 * the real name + email from the shipping details — but never overwrite values
 * the user already has.
 *
 * Best-effort: never throws (a duplicate email just leaves the profile as-is).
 */
async function backfillUserProfile(userId, shippingInfo = {}) {
  if (!userId || !shippingInfo) return;

  const user = await User.findById(userId).select("fullName email");
  if (!user) return;

  const updates = {};
  if ((!user.fullName || user.fullName === "User") && shippingInfo.fullName?.trim()) {
    updates.fullName = shippingInfo.fullName.trim();
  }
  if (!user.email && shippingInfo.email?.trim()) {
    updates.email = shippingInfo.email.trim().toLowerCase();
  }

  if (!Object.keys(updates).length) return;

  try {
    await User.updateOne({ _id: userId }, updates);
  } catch (err) {
    // Likely a duplicate email (sparse-unique index) — skip, keep profile as-is.
    console.error(`[profile] backfill skipped for ${userId}: ${err.message}`);
  }
}

module.exports = { backfillUserProfile };
