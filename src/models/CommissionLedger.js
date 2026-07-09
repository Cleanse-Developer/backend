const mongoose = require("mongoose");

// Commission accrual ledger for external promoters. Mirrors LoyaltyTransaction:
// one `earned` row per attributed order (unique {order, type} => idempotent across
// the three order-confirm paths and any retries). The row's `status` is the state
// machine: pending -> approved -> settled, or -> reversed on cancel/refund (we flip
// status rather than writing a negative mirror row). `adjustment` rows are manual
// admin corrections (± amount).
const commissionLedgerSchema = new mongoose.Schema(
  {
    promoter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promoter",
      required: true,
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" }, // null for manual adjustment
    type: {
      type: String,
      enum: ["earned", "adjustment"],
      required: true,
    },
    // Integer rupees. Positive for earned; adjustment may be ±. Reversal flips
    // `status` to "reversed" (the amount is left intact for audit).
    amount: { type: Number, required: true },

    // Snapshots frozen at accrual time so later promoter edits never rewrite history.
    basis: { type: String, default: "net_merchandise" },
    basisAmount: { type: Number },
    commissionRate: { type: Number },
    commissionType: { type: String },

    status: {
      type: String,
      enum: ["pending", "approved", "reversed", "settled"],
      default: "pending",
    },
    settlement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Settlement",
      default: null,
    },

    via: { type: String, enum: ["code", "link"] },
    code: { type: String }, // the coupon code that attributed (when via=code)

    approvedAt: { type: Date },
    reversedAt: { type: Date },
    settledAt: { type: Date },

    description: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // admin, for adjustments
  },
  { timestamps: true }
);

commissionLedgerSchema.index({ promoter: 1, createdAt: -1 });
commissionLedgerSchema.index({ promoter: 1, status: 1 });
commissionLedgerSchema.index({ settlement: 1 });
// Idempotency key: at most one row per (order, type). Sparse so adjustment rows
// with no order don't collide on null.
commissionLedgerSchema.index({ order: 1, type: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("CommissionLedger", commissionLedgerSchema);
