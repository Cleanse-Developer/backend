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

    // Benefit copy for the diagonal ribbon on the homepage bundle section.
    // Rendered in a fixed 168px rotated banner, so long values clip — hence 40.
    // Empty falls back to the discount-derived "Save 15%" label.
    ribbonText: { type: String, maxlength: 40, trim: true },

    // Exactly one bundle is the homepage "Build Your Ritual" pick. Enforced in
    // the admin controller, which unsets the flag on every other bundle.
    isFeatured: { type: Boolean, default: false },

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
bundleSchema.index({ isActive: 1, isFeatured: 1 });
bundleSchema.index({ "products": 1 });
bundleSchema.index({ "displayOnProducts": 1 });

module.exports = mongoose.model("Bundle", bundleSchema);
