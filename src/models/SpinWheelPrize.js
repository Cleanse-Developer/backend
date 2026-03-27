const mongoose = require("mongoose");

const spinWheelPrizeSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, required: true, unique: true, trim: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
    discountType: {
      type: String,
      enum: ["percentage", "fixed", "free_shipping", null],
      default: null,
    },
    discountValue: { type: Number, default: 0 },
    color: { type: String, default: "#4F2C22" },
    textColor: { type: String, default: "#F0EDE8" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SpinWheelPrize", spinWheelPrizeSchema);
