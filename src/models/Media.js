const mongoose = require("mongoose");

// Registry of every media asset uploaded through the app (image or video),
// across storage providers. Populated on each upload + by scripts/backfill-media.js.
// Read-only from the admin UI (no destructive actions).
const mediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    // Provider delete handle: Cloudinary public_id or S3 object key. Unique so the
    // backfill script can upsert idempotently.
    publicId: { type: String, required: true, unique: true },
    provider: { type: String, enum: ["cloudinary", "s3"], required: true },
    folder: { type: String, default: "" },
    resourceType: { type: String, enum: ["image", "video"], default: "image" },
    mimetype: { type: String, default: "" },
    format: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    width: { type: Number },
    height: { type: Number },
    originalName: { type: String, default: "" },
    optimized: { type: Boolean, default: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

mediaSchema.index({ createdAt: -1 });
mediaSchema.index({ folder: 1 });
mediaSchema.index({ resourceType: 1 });
mediaSchema.index({ provider: 1 });
mediaSchema.index({ originalName: "text", folder: "text" });

module.exports = mongoose.model("Media", mediaSchema);
