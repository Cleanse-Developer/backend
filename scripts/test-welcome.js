/*
 * Sends the REAL newsletter welcome email (unsubscribe footer + coupon block —
 * i.e. the spam-prone one) to a target address, using the current .env, without
 * touching the DB. Confirms deliverability/placement of the newsletter email
 * specifically (vs the transactional spin email).
 *
 *   node scripts/test-welcome.js you@example.com
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { sendWelcomeEmail } = require("../src/services/email.service");

const to = process.argv[2];
(async () => {
  if (!to) {
    console.log("usage: node scripts/test-welcome.js <email>");
    process.exit(1);
  }
  console.log("EMAIL_FROM =", process.env.EMAIL_FROM);
  const info = await sendWelcomeEmail(
    { email: to, unsubscribeToken: "test-token-123" },
    "WELCOME-10-TESTCODE"
  );
  console.log("result:", JSON.stringify({ accepted: info?.accepted, rejected: info?.rejected, messageId: info?.messageId }));
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
