const mongoose = require("mongoose");

const testimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "Verified Buyer", trim: true },
    headline: { type: String, required: true, trim: true },
    text: { type: String, required: true },
    beforeImage: { type: String },
    afterImage: { type: String },
    // "review" = only text/rating, "before-after" = only before/after images, "both" = both
    type: {
      type: String,
      enum: ["review", "before-after", "both"],
      default: "review",
    },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    productName: { type: String }, // denormalized for easy display
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

testimonialSchema.index({ isActive: 1, sortOrder: 1 });
testimonialSchema.index({ type: 1, isActive: 1 });

module.exports = mongoose.model("Testimonial", testimonialSchema);
