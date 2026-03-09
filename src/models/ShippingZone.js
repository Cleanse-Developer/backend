const mongoose = require("mongoose");

const shippingZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    pincodes: [String],
    states: [String],
    rates: {
      standard: { type: Number, default: 99 },
      express: { type: Number, default: 149 },
      freeAbove: { type: Number, default: 1200 },
    },
    estimatedDays: {
      standard: { type: String, default: "3-5" },
      express: { type: String, default: "1-2" },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShippingZone", shippingZoneSchema);
