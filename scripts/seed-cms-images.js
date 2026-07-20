/**
 * Seed real CMS images to S3 for the sections that ship with local `/...`
 * placeholder paths (which the admin origin can't load → broken previews).
 *
 * For each targeted CMS section: take the current DB doc if present, else the
 * controller default; recursively find every image `{ url }` whose url is a
 * local `/...` path; upload the matching file from frontend/public to S3
 * (CloudFront) once; rewrite url + publicId; upsert the Settings doc.
 *
 * MERGE-PRESERVING: only local-path image urls are rewritten. Any admin-edited
 * text or already-S3 image is left untouched. Idempotent + re-runnable (a
 * second run finds only S3 urls and uploads nothing).
 *
 * Usage:
 *   node scripts/seed-cms-images.js --dry   # resolve files + report, no upload/write
 *   node scripts/seed-cms-images.js         # live: upload to S3 + upsert Settings
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Settings = require("../src/models/Settings");
const { uploadImage } = require("../src/services/upload.service");
const { CMS_DEFAULTS } = require("../src/controllers/settings.controller");

const DRY = process.argv.includes("--dry");
const FRONTEND_PUBLIC = path.resolve(__dirname, "../../frontend/public");
const SECTIONS = ["cmsRitualBanner", "cmsRitualPage", "cmsGenesis", "cmsContact"];

const cache = new Map(); // localUrl -> { url, publicId } | null
const missing = new Set();

function mimeFor(rel) {
  const e = rel.toLowerCase();
  if (e.endsWith(".png")) return "image/png";
  if (e.endsWith(".jpg") || e.endsWith(".jpeg")) return "image/jpeg";
  if (e.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function uploadLocal(localUrl) {
  if (cache.has(localUrl)) return cache.get(localUrl);
  const rel = decodeURIComponent(localUrl.replace(/^\//, "")); // "images/facecream mock.png"
  const abs = path.join(FRONTEND_PUBLIC, rel);
  if (!fs.existsSync(abs)) {
    missing.add(localUrl);
    cache.set(localUrl, null);
    return null;
  }
  if (DRY) {
    const stub = { url: `DRY(${localUrl})`, publicId: null };
    cache.set(localUrl, stub);
    console.log("  would upload", localUrl);
    return stub;
  }
  const buf = fs.readFileSync(abs);
  const res = await uploadImage(buf, "cleanse/cms", mimeFor(rel), {
    optimize: true,
    originalName: path.basename(rel),
  });
  cache.set(localUrl, res);
  console.log("  uploaded", localUrl, "->", res.url);
  return res;
}

// Recursively rewrite local-path image urls in place.
async function walk(node) {
  if (Array.isArray(node)) {
    for (const x of node) await walk(x);
    return;
  }
  if (node && typeof node === "object") {
    if (typeof node.url === "string" && node.url.startsWith("/")) {
      const r = await uploadLocal(node.url);
      if (r) {
        node.url = r.url;
        node.publicId = r.publicId;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === "url" || k === "publicId") continue;
      await walk(node[k]);
    }
  }
}

(async () => {
  await connectDB();
  console.log(`Connected. Mode: ${DRY ? "DRY RUN (no upload/write)" : "LIVE"}\n`);

  for (const key of SECTIONS) {
    const existing = await Settings.findOne({ key }).lean();
    const base = existing?.value
      ? JSON.parse(JSON.stringify(existing.value))
      : JSON.parse(JSON.stringify(CMS_DEFAULTS[key]));
    console.log(`[${key}] source: ${existing?.value ? "existing DB doc" : "controller default"}`);
    await walk(base);
    if (!DRY) {
      await Settings.findOneAndUpdate(
        { key },
        { $set: { key, value: base } },
        { upsert: true, new: true }
      );
      console.log(`  saved ${key}`);
    }
  }

  const uploaded = [...cache.entries()].filter(([, v]) => v && !missing.has(v)).length;
  console.log(`\nDone. ${cache.size} distinct image(s) processed.`);
  if (missing.size) console.log("MISSING files (left as-is):", [...missing].join(", "));

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
