const mongoose = require("mongoose");
const responsiveSources = require("./shared/responsiveSources");

// Product-detail highlight cards (see `highlights` on the schema below).
const MAX_HIGHLIGHT_CARDS = 3;
const HIGHLIGHT_CTA_TARGETS = [
  "ingredients", // opens the Ingredients tab
  "why-it-works", // opens the "Why it works" tab
  "how-to-use", // opens the How to Use tab
  "ritual", // links to /ritual
  "url", // links to cta.url
];
// An empty string from a half-filled admin form means "not set".
const emptyToUndefined = (v) => (v === "" || v === null ? undefined : v);

const highlightCardSchema = new mongoose.Schema(
  {
    eyebrow: { type: String, trim: true, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    // Large callout line under the title, e.g. "Bhringraj + Amla".
    highlight: { type: String, trim: true, maxlength: 80 },
    body: { type: String, trim: true, maxlength: 500 },
    // Optional chip row with its label, e.g. "Targets": Hair Fall, Weak Roots.
    chipsLabel: { type: String, trim: true, maxlength: 30 },
    chips: {
      type: [{ type: String, trim: true, maxlength: 60 }],
      validate: {
        validator: (chips) => chips.length <= 6,
        message: "A highlight card can have at most 6 chips",
      },
    },
    cta: {
      label: { type: String, trim: true, maxlength: 40, set: emptyToUndefined },
      target: { type: String, enum: HIGHLIGHT_CTA_TARGETS, set: emptyToUndefined },
      // Only used when target === "url".
      url: { type: String, trim: true, maxlength: 500, set: emptyToUndefined },
    },
    // Pre-uploaded through POST /admin/cms/upload-image, so { url, publicId }.
    image: {
      url: { type: String, trim: true, set: emptyToUndefined },
      publicId: { type: String, set: emptyToUndefined },
      alt: { type: String, trim: true, maxlength: 160 },
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, required: true, maxlength: 5000 },
    shortDescription: { type: String },
    benefits: [{ type: String }],
    skinType: [{ type: String }],
    concerns: [{ type: String }],
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number },
    // Unit cost (COGS) — product-level fallback used when a size has no costPrice.
    // Powers gross-profit / margin in the admin KPI dashboard. Optional.
    costPrice: { type: Number, min: 0 },
    color: { type: String, trim: true },
    tag: {
      type: String,
      required: true,
      enum: ["Face Care", "Hair Care", "Body Care"],
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },
    sizes: [
      {
        label: { type: String },
        price: { type: Number },
        compareAtPrice: { type: Number },
        // Per-variant unit cost (COGS), preferred over product-level costPrice.
        costPrice: { type: Number, min: 0 },
        sku: { type: String },
        stock: { type: Number, default: 0 },
      },
    ],
    images: [
      {
        url: { type: String },
        alt: { type: String },
        isPrimary: { type: Boolean, default: false },
        sources: responsiveSources,
      },
    ],
    ingredients: { type: String },
    howToUse: { type: String },
    values: { type: String },
    shippingInfo: { type: String },
    policies: { type: String },
    tabHighlights: {
      ingredients: [{ icon: { type: String }, label: { type: String } }],
      values: [{ icon: { type: String }, label: { type: String } }],
      howToUse: [{ icon: { type: String }, label: { type: String } }],
      shippingInfo: [{ icon: { type: String }, label: { type: String } }],
      policies: [{ icon: { type: String }, label: { type: String } }],
    },
    // Storefront product-detail hero "listing content" (title, marketing blurb,
    // and the tag/helps/targets chips). Previously hardcoded per-product in the
    // storefront (productListingContent.js); now admin-editable per product.
    // Empty fields fall back to the shipped hardcoded content on the storefront.
    listingContent: {
      title: { type: String },
      description: { type: String },
      tags: [{ type: String }],
      helps: [{ type: String }],
      targets: [{ type: String }],
    },
    // Storefront product-detail "highlights" section, shown right below the hero
    // (up to MAX_HIGHLIGHT_CARDS cards: formula story, concern, ritual...). Fully
    // optional: the storefront renders nothing when a product has no cards, so
    // products without this content are unaffected. Not to be confused with
    // tabHighlights above, which are the icon chips inside the info tabs.
    highlights: {
      eyebrow: { type: String, trim: true, maxlength: 40 },
      title: { type: String, trim: true, maxlength: 100 },
      cards: {
        type: [highlightCardSchema],
        validate: {
          validator: (cards) => cards.length <= MAX_HIGHLIGHT_CARDS,
          message: `A product can have at most ${MAX_HIGHLIGHT_CARDS} highlight cards`,
        },
      },
    },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    totalStock: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    isFeatured: { type: Boolean, default: false },
    // Manual ordering for the storefront "Best Sellers" (featured) section.
    // Lower = shown first. Only meaningful when isFeatured is true.
    featuredOrder: { type: Number, default: 0 },
    isBundleable: { type: Boolean, default: false },
    seo: {
      metaTitle: { type: String },
      metaDescription: { type: String },
      keywords: [{ type: String }],
    },
  },
  { timestamps: true }
);

// Indexes
productSchema.index({ tag: 1, isActive: 1 });
productSchema.index({ price: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ isActive: 1, isFeatured: 1, featuredOrder: 1 });
productSchema.index({ isActive: 1, isBundleable: 1 });
productSchema.index({ category: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ "sizes.sku": 1 }, { unique: true, sparse: true });

// Pre-save hook: auto-compute totalStock + validate unique SKUs
productSchema.pre("save", function (next) {
  if (this.sizes && this.sizes.length > 0) {
    this.totalStock = this.sizes.reduce((sum, size) => sum + (size.stock || 0), 0);

    // Ensure every size has a sku
    const skus = this.sizes.map((s) => s.sku).filter(Boolean);
    if (skus.length !== this.sizes.length) {
      return next(new Error("Every size variant must have a SKU"));
    }
    // Ensure no duplicate SKUs within this product
    if (new Set(skus).size !== skus.length) {
      return next(new Error("Duplicate SKUs within the same product are not allowed"));
    }
  }
  next();
});

module.exports = mongoose.model("Product", productSchema);
