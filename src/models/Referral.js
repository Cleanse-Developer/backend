const mongoose = require("mongoose");

const referralSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referralCode: { type: String, required: true },
    rewardAmount: { type: Number, default: 200 },
    isRewarded: { type: Boolean, default: false },
    qualifyingOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    rewardedAt: { type: Date },
    rewardReversedAt: { type: Date },
  },
  { timestamps: true }
);

referralSchema.index({ referrer: 1 });
referralSchema.index({ referee: 1 }, { unique: true });
referralSchema.index({ referralCode: 1 });

module.exports = mongoose.model("Referral", referralSchema);
