const mongoose = require("mongoose");

// A bookkeeping settlement batch. Groups a promoter's `approved` commission ledger
// rows for a period and marks them paid. NO real money movement happens here — the
// `reference` is a manually-entered note (UTR / UPI ref / cheque no.), not a payout
// API id.
const settlementSchema = new mongoose.Schema(
  {
    settlementId: { type: String, required: true, unique: true }, // "STL-2026-0001"
    promoter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promoter",
      required: true,
    },
    periodFrom: { type: Date },
    periodTo: { type: Date },
    ledgerEntries: [
      { type: mongoose.Schema.Types.ObjectId, ref: "CommissionLedger" },
    ],
    totalAmount: { type: Number, required: true, default: 0 },
    entryCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "finalized", "paid"],
      default: "draft",
    },
    method: {
      type: String,
      enum: ["bank", "upi", "paypal", "manual"],
      default: "manual",
    },
    reference: { type: String, trim: true }, // manual UTR / UPI ref / note
    notes: { type: String, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    finalizedAt: { type: Date },
    settledAt: { type: Date },
  },
  { timestamps: true }
);

settlementSchema.index({ promoter: 1, createdAt: -1 });
settlementSchema.index({ status: 1 });

module.exports = mongoose.model("Settlement", settlementSchema);
