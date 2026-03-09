const mongoose = require("mongoose");

const loyaltyTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["earned", "redeemed", "expired", "referral_bonus"],
      required: true,
    },
    points: { type: Number, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    description: { type: String },
  },
  { timestamps: true }
);

loyaltyTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("LoyaltyTransaction", loyaltyTransactionSchema);
