const agenda = require("../config/agenda");
const Order = require("../models/Order");
const CommissionLedger = require("../models/CommissionLedger");
const {
  getPromoterConfig,
  recomputePromoterTotals,
} = require("../services/promoter.service");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Promote `pending` promoter commissions to `approved` once their order has been
 * delivered and the return window has elapsed. Only `approved` rows are eligible
 * for settlement, so this is the gate that protects against paying commission on
 * orders the customer can still return. Scheduled to run daily.
 */
agenda.define("approve-promoter-commissions", async () => {
  try {
    const { autoApproveAfterDays } = await getPromoterConfig();
    const cutoff = new Date(Date.now() - (autoApproveAfterDays || 7) * DAY_MS);

    // Orders that are delivered, past the window, and attributed to a promoter.
    const orders = await Order.find({
      "attribution.promoter": { $ne: null },
      status: "delivered",
      deliveredAt: { $lte: cutoff },
    })
      .select("_id")
      .lean();
    if (orders.length === 0) return;

    const orderIds = orders.map((o) => o._id);

    // Capture which promoters are affected BEFORE the update (so we can refresh
    // their cached totals afterwards).
    const rows = await CommissionLedger.find({
      order: { $in: orderIds },
      status: "pending",
      type: "earned",
    })
      .select("promoter")
      .lean();
    if (rows.length === 0) return;

    const result = await CommissionLedger.updateMany(
      { order: { $in: orderIds }, status: "pending", type: "earned" },
      { $set: { status: "approved", approvedAt: new Date() } }
    );

    // Recompute cached totals for each affected promoter.
    const seen = new Map();
    for (const r of rows) seen.set(r.promoter.toString(), r.promoter);
    for (const promoterId of seen.values()) {
      await recomputePromoterTotals(promoterId);
    }

    console.log(
      `Promoter commissions: approved ${result.modifiedCount} row(s) across ${seen.size} promoter(s)`
    );
  } catch (err) {
    console.error("Promoter commission approval job error:", err.message);
    throw err;
  }
});
