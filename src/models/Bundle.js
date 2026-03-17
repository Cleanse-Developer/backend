const mongoose = require("mongoose");

const bundleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, maxlength: 1000 },
    subtitle: { type: String, maxlength: 300 }, // e.g. "SELECT PRODUCTS AND SAVE 15% ON YOUR BUNDLE"

    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
    ],

    // Discount configuration
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },

    // Minimum number of products from this bundle that must be in cart to qualify
    minProducts: { type: Number, required: true, min: 2, default: 3 },

    // Display
    image: {
      url: { type: String },
      alt: { type: String },
    },

    // Which product page(s) should show this bundle
    displayOnProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 0 }, // higher = shown first
  },
  { timestamps: true }
);

bundleSchema.index({ isActive: 1, priority: -1 });
bundleSchema.index({ "products": 1 });
bundleSchema.index({ "displayOnProducts": 1 });

module.exports = mongoose.model("Bundle", bundleSchema);
