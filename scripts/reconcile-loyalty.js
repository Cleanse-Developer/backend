/*
 * One-off reconciliation for the loyalty-reversal fix.
 *
 * 1) Backfill Order.loyaltyPointsAwarded from the loyalty ledger, so future
 *    cancels/refunds of ALREADY-EARNED orders reverse the right amount. Per order:
 *    loyaltyPointsAwarded = max(0, Σ earned + Σ reversed) — i.e. points still
 *    standing as awarded. (Earned txns are +, reversed txns are −; an order that
 *    was earned then already reversed nets 0; a phantom-reversed order nets 0.)
 *
 * 2) Fix invalid NEGATIVE balances (the bug's symptom) → clamp to 0, and append a
 *    manual_adjustment transaction so the ledger stays consistent + auditable
 *    (append-only; we never delete the historical bad reversal).
 *
 * Idempotent — safe to re-run.
 *
 *   node scripts/reconcile-loyalty.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const User = require("../src/models/User");
const Order = require("../src/models/Order");
const LoyaltyTransaction = require("../src/models/LoyaltyTransaction");

const run = async () => {
  await connectDB();

  // 1) Backfill Order.loyaltyPointsAwarded from the ledger.
  const netByOrder = await LoyaltyTransaction.aggregate([
    { $match: { order: { $ne: null }, type: { $in: ["earned", "reversed"] } } },
    { $group: { _id: "$order", net: { $sum: "$points" } } },
  ]);
  let backfilled = 0;
  for (const row of netByOrder) {
    const awarded = Math.max(0, row.net);
    const r = await Order.updateOne(
      { _id: row._id, loyaltyPointsAwarded: { $ne: awarded } },
      { $set: { loyaltyPointsAwarded: awarded } }
    );
    if (r.modifiedCount) backfilled++;
  }
  console.log(
    `1) Backfill: ${netByOrder.length} orders have loyalty txns; updated loyaltyPointsAwarded on ${backfilled}.`
  );

  // 2) Fix negative balances → 0 with an audit transaction.
  const negatives = await User.find({ loyaltyPoints: { $lt: 0 } })
    .select("_id email loyaltyPoints")
    .lean();
  console.log(`2) Users with negative balance: ${negatives.length}`);
  let fixed = 0;
  for (const u of negatives) {
    // Atomic clamp (guarded so a re-run / concurrent write is a no-op).
    const before = await User.findOneAndUpdate(
      { _id: u._id, loyaltyPoints: { $lt: 0 } },
      [{ $set: { loyaltyPoints: 0 } }],
      { new: false }
    );
    if (!before) continue;
    const correction = -before.loyaltyPoints; // positive
    await LoyaltyTransaction.create({
      user: u._id,
      type: "manual_adjustment",
      points: correction,
      description: `System correction: loyalty balance restored to 0 (was ${before.loyaltyPoints}). Points had been reversed from an order cancelled before they were ever credited.`,
    });
    fixed++;
    console.log(`   ${u.email || u._id}: ${before.loyaltyPoints} → 0  (+${correction} correction)`);
  }
  console.log(`   Fixed ${fixed} negative balance(s).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Reconcile error:", err);
  process.exit(1);
});
