const mongoose = require("mongoose");
const responsiveSources = require("./shared/responsiveSources");

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
