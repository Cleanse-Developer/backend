const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: { type: String, required: true },
    discountType: {
      type: String,
      enum: ["percentage", "fixed", "free_shipping"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
    minOrderValue: { type: Number, default: 0 },
    maxDiscountAmount: { type: Number },
    validFrom: { type: Date, default: Date.now },
    validTill: { type: Date, required: true },
    usageLimit: { type: Number },
    usageCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 },
    usedBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        usedAt: { type: Date },
      },
    ],
    applicableProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    ],
    applicableCategories: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    ],
    isActive: { type: Boolean, default: true },
    isFirstOrderOnly: { type: Boolean, default: false },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, validTill: 1 });

module.exports = mongoose.model("Coupon", couponSchema);
