/*
 * One-off seed for the /blog ("The Journal") page CMS section.
 *
 * Writes a real Settings document for `cmsBlog` holding the current copy plus the
 * hero + newsletter images. The two shipped static images (frontend /public) are
 * uploaded to the media provider (Cloudinary) so the stored URLs are absolute —
 * they render in BOTH the storefront and the admin editor preview (the admin runs
 * on a different origin and can't serve the storefront's /images/* assets, which
 * is why seeding the raw static paths showed broken thumbnails).
 *
 * Idempotent: an image already stored as an absolute http(s) URL is reused, so
 * re-running never re-uploads. Upserts the single key, touches nothing else.
 *
 *   node scripts/seed-cms-blog.js      (or: npm run seed:cms-blog)
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const fs = require("fs");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Settings = require("../src/models/Settings");
const { CMS_DEFAULTS } = require("../src/controllers/settings.controller");
const { uploadImage } = require("../src/services/upload.service");

// Which cmsBlog image fields map to which shipped static asset.
const IMAGE_FIELDS = {
  heroImage: { file: "b2.png", mime: "image/png" },
  newsletterImage: { file: "cta.png", mime: "image/png" },
};
const PUBLIC_IMAGES_DIR = path.join(__dirname, "../../frontend/public/images");

const isHosted = (img) =>
  typeof img?.url === "string" && /^https?:\/\//i.test(img.url);

const run = async () => {
  await connectDB();

  // Start from defaults, overlay whatever's already saved (so we keep any admin
  // edits + already-hosted images), then ensure the two images are hosted.
  const existing = await Settings.findOne({ key: "cmsBlog" }).lean();
  const value = { ...CMS_DEFAULTS.cmsBlog, ...(existing?.value || {}) };

  for (const [field, { file, mime }] of Object.entries(IMAGE_FIELDS)) {
    if (isHosted(value[field])) {
      console.log(`  • ${field}: already hosted — ${value[field].url}`);
      continue;
    }
    const filePath = path.join(PUBLIC_IMAGES_DIR, file);
    const buffer = fs.readFileSync(filePath);
    console.log(
      `  • ${field}: uploading ${file} (${(buffer.length / 1024).toFixed(0)} KB) → media provider...`
    );
    const result = await uploadImage(buffer, "cleanse/cms", mime, {
      optimize: true,
      originalName: file,
    });
    value[field] = result; // full media object: { url, publicId, ... }
    console.log(`    ↳ ${result.url}`);
  }

  await Settings.findOneAndUpdate(
    { key: "cmsBlog" },
    { key: "cmsBlog", value },
    { upsert: true, new: true }
  );

  console.log("\n  ✓ cmsBlog seeded:");
  console.log("    heroImage       :", value.heroImage?.url);
  console.log("    newsletterImage :", value.newsletterImage?.url);
  console.log("    heroTitle       :", value.heroTitle);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
