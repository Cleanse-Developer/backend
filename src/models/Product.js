const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, required: true, maxlength: 2000 },
    shortDescription: { type: String, maxlength: 500 },
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
        sku: { type: String },
        stock: { type: Number, default: 0 },
      },
    ],
    images: [
      {
        url: { type: String },
        alt: { type: String },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    ingredients: { type: String },
    howToUse: { type: String },
    values: { type: String },
    shippingInfo: { type: String },
    policies: { type: String },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    totalStock: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
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
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ category: 1 });
productSchema.index({ createdAt: -1 });

// Pre-save hook: auto-compute totalStock from sizes
productSchema.pre("save", function (next) {
  if (this.sizes && this.sizes.length > 0) {
    this.totalStock = this.sizes.reduce((sum, size) => sum + (size.stock || 0), 0);
  }
  next();
});

module.exports = mongoose.model("Product", productSchema);
