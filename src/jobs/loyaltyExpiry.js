const agenda = require("../config/agenda");
const { expirePoints } = require("../services/loyalty.service");

/**
 * Expire loyalty points older than the configured `expiryDays`.
 * Scheduled to run daily.
 */
agenda.define("expire-loyalty-points", async () => {
  try {
    const result = await expirePoints();
    if (result.expired > 0) {
      console.log(
        `Loyalty expiry: processed ${result.processed} users, expired ${result.expired} points`
      );
    }
  } catch (err) {
    console.error("Loyalty expiry job error:", err.message);
    throw err;
  }
});
