const mongoose = require("mongoose");

const spinWheelEntrySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    prize: { type: String, required: true },
    prizeValue: { type: String, required: true },
    couponCode: { type: String, default: null },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isRedeemed: { type: Boolean, default: false },
    redeemedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

spinWheelEntrySchema.index({ email: 1, createdAt: -1 });
spinWheelEntrySchema.index({ couponCode: 1 }, { sparse: true });

module.exports = mongoose.model("SpinWheelEntry", spinWheelEntrySchema);
