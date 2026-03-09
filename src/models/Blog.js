const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: ["Hair Care", "Skin Care", "Wellness", "Ingredients", "Rituals"],
    },
    excerpt: { type: String, maxlength: 500 },
    content: [{ type: String }],
    image: { type: String },
    readTime: { type: String },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Author",
      required: true,
    },
    isFeatured: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    viewCount: { type: Number, default: 0 },
    seo: {
      metaTitle: { type: String },
      metaDescription: { type: String },
    },
    tags: [{ type: String }],
  },
  { timestamps: true }
);

blogSchema.index({ isPublished: 1, publishedAt: -1 });
blogSchema.index({ category: 1 });
blogSchema.index({ isFeatured: 1 });
blogSchema.index({ title: "text", excerpt: "text" });

// If status changed to published and no publishedAt, set publishedAt to now
blogSchema.pre("save", function (next) {
  if (this.isModified("isPublished") && this.isPublished && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

module.exports = mongoose.model("Blog", blogSchema);
