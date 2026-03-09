const mongoose = require("mongoose");

const authorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    bio: { type: String, maxlength: 1000 },
    role: { type: String, trim: true },
    avatar: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Auto-generate slug from name if not set
authorSchema.pre("save", function (next) {
  if (!this.slug || this.isModified("name")) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
  next();
});

module.exports = mongoose.model("Author", authorSchema);
