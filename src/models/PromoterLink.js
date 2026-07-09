const mongoose = require("mongoose");

// A named, dynamic tracking link for a promoter (e.g. "IG bio", "YT video").
// The public redirect `GET /r/:slug` increments reach counters, drops a last-click
// attribution cookie, and 302s to the storefront (optionally auto-applying a bound
// coupon code into the single coupon input). A promoter may have many links.
const promoterLinkSchema = new mongoose.Schema(
  {
    promoter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promoter",
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    label: { type: String, trim: true },
    // Storefront path the link lands on (e.g. "/", "/products/some-slug").
    destinationPath: { type: String, default: "/" },
    // Optional: the code this link auto-applies into the single coupon input.
    // Must be a Coupon/SpecialCoupon code owned by the same promoter.
    boundCouponCode: { type: String, uppercase: true, trim: true, default: null },

    // Reach tracking.
    clickCount: { type: Number, default: 0 },
    uniqueVisitorCount: { type: Number, default: 0 },
    conversionCount: { type: Number, default: 0 },
    lastClickAt: { type: Date },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

promoterLinkSchema.index({ promoter: 1 });

module.exports = mongoose.model("PromoterLink", promoterLinkSchema);
