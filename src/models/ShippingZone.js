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
      // Per-payment-method overrides. When set, these win over the legacy
      // `standard`/`freeAbove` above (which stay as the fallback for older zones
      // created before the COD/prepaid split). Resolution: pricing.service
      // resolveShippingConfig() reads rates[method].standard ?? rates.standard.
      prepaid: {
        standard: { type: Number },
        freeAbove: { type: Number },
      },
      cod: {
        standard: { type: Number },
        freeAbove: { type: Number },
      },
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
