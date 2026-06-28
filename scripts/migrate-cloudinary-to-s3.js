/**
 * One-time migration: move every Cloudinary asset REFERENCED by app content to S3.
 *
 * For each referenced https://res.cloudinary.com/... URL across the content collections:
 *   download → (images) convert to WebP (visually-lossless) → upload to S3/CloudFront →
 *   rewrite the DB field to the new URL. Cloudinary is NOT deleted. Finally, all Cloudinary
 *   entries in the Media registry are hidden from the admin Media tab.
 *
 * Schema-agnostic (raw driver + recursive walk) so it catches plain-string URLs and the
 * nested {url,publicId} objects inside Settings.value (CMS). Idempotent + re-runnable.
 *
 * Usage:
 *   node scripts/migrate-cloudinary-to-s3.js --dry   # scan + report, no writes
 *   node scripts/migrate-cloudinary-to-s3.js         # live
 */

require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../src/config/env");
const Media = require("../src/models/Media");
const s3 = require("../src/services/storage/s3.provider");
const { toWebp, probe } = require("../src/utils/imageOptimize");

const DRY = process.argv.includes("--dry");

const CONTENT_COLLECTIONS = [
  "products",
  "categories",
  "blogs",
  "testimonials",
  "authors",
  "bundles",
  "settings",
];

const CLOUDINARY_RE = /^https?:\/\/res\.cloudinary\.com\//i;
const isCloudinary = (s) => typeof s === "string" && CLOUDINARY_RE.test(s);

// Only recurse real plain containers — never BSON ObjectIds, Dates, or Buffers.
const isContainer = (v) =>
  v &&
  typeof v === "object" &&
  !Buffer.isBuffer(v) &&
  !(v instanceof Date) &&
  !v._bsontype;

const urlCache = new Map(); // cloudinaryUrl -> newUrl (per run)
const stats = { found: 0, migrated: 0, reused: 0, failed: 0, bytesIn: 0, bytesOut: 0 };
const failures = [];

const basename = (url) => {
  try {
    const path = decodeURIComponent(url.split("?")[0]);
    return path.substring(path.lastIndexOf("/") + 1) || "asset";
  } catch {
    return "asset";
  }
};

async function migrate(url) {
  if (urlCache.has(url)) {
    stats.reused++;
    return urlCache.get(url);
  }
  // Persisted dedupe across runs.
  const existing = await Media.findOne({ migratedFrom: url }).lean();
  if (existing) {
    urlCache.set(url, existing.url);
    stats.reused++;
    return existing.url;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  let buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "";
  stats.bytesIn += buffer.length;

  const isVid =
    url.includes("/video/upload/") || contentType.startsWith("video/");

  let mimetype;
  let optimized = false;
  let dims = {};

  if (isVid) {
    mimetype = contentType || "video/mp4";
  } else {
    const alreadyWebp =
      contentType.includes("webp") || /\.webp(\?|$)/i.test(url);
    if (!alreadyWebp) {
      const w = await toWebp(buffer); // throws if not a decodable image
      buffer = w.buffer;
      mimetype = w.mimetype;
      optimized = true;
      dims = { width: w.width, height: w.height, format: w.format };
    } else {
      mimetype = "image/webp";
      dims = await probe(buffer);
    }
  }
  if (!isVid && !dims.width) dims = await probe(buffer);

  const result = isVid
    ? await s3.uploadVideo(buffer, "migrated", mimetype)
    : await s3.uploadImage(buffer, "migrated", mimetype);

  let originalName = basename(url);
  if (optimized) originalName = originalName.replace(/\.[^.]+$/, "") + ".webp";

  await Media.create({
    url: result.url,
    publicId: result.publicId,
    provider: "s3",
    folder: "migrated",
    resourceType: isVid ? "video" : "image",
    mimetype,
    format: isVid ? "" : dims.format || "webp",
    bytes: buffer.length,
    width: dims.width,
    height: dims.height,
    originalName,
    optimized,
    migratedFrom: url,
    hidden: false,
  });

  stats.migrated++;
  stats.bytesOut += buffer.length;
  urlCache.set(url, result.url);
  return result.url;
}

// Recursively replace Cloudinary URLs in place. Returns { changed, value }.
async function walk(node) {
  if (isCloudinary(node)) {
    stats.found++;
    // In dry mode mark "changed" (value untouched) so per-doc/collection counts are accurate.
    if (DRY) return { changed: true, value: node };
    try {
      const newUrl = await migrate(node);
      return { changed: newUrl !== node, value: newUrl };
    } catch (err) {
      stats.failed++;
      failures.push({ url: node, error: err.message });
      console.error(`  ! failed: ${node} — ${err.message}`);
      return { changed: false, value: node };
    }
  }
  if (Array.isArray(node)) {
    let changed = false;
    for (let i = 0; i < node.length; i++) {
      const r = await walk(node[i]);
      if (r.changed) {
        node[i] = r.value;
        changed = true;
      }
    }
    return { changed, value: node };
  }
  if (isContainer(node)) {
    let changed = false;
    for (const key of Object.keys(node)) {
      const r = await walk(node[key]);
      if (r.changed) {
        node[key] = r.value;
        changed = true;
      }
    }
    return { changed, value: node };
  }
  return { changed: false, value: node };
}

async function migrateCollection(db, name) {
  const col = db.collection(name);
  const cursor = col.find({});
  let docs = 0;
  let updated = 0;
  for await (const doc of cursor) {
    docs++;
    const changedKeys = [];
    for (const key of Object.keys(doc)) {
      if (key === "_id") continue;
      const r = await walk(doc[key]);
      if (r.changed) {
        doc[key] = r.value;
        changedKeys.push(key);
      }
    }
    if (changedKeys.length && !DRY) {
      const set = {};
      for (const k of changedKeys) set[k] = doc[k];
      await col.updateOne({ _id: doc._id }, { $set: set });
      updated++;
    } else if (changedKeys.length) {
      updated++; // dry: would-update count
    }
    if (docs % 50 === 0) process.stdout.write(`  ${name}: ${docs} scanned...\n`);
  }
  console.log(
    `  ${name}: ${docs} docs, ${updated} ${DRY ? "would be " : ""}updated`
  );
}

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(
    `Mongo connected. ${DRY ? "DRY RUN — " : ""}migrating referenced Cloudinary media → S3\n`
  );

  for (const name of CONTENT_COLLECTIONS) {
    try {
      await migrateCollection(db, name);
    } catch (err) {
      console.error(`Collection ${name} error:`, err.message);
    }
  }

  if (!DRY) {
    const r = await Media.updateMany(
      { provider: "cloudinary" },
      { $set: { hidden: true } }
    );
    console.log(`\nHid ${r.modifiedCount} Cloudinary entries from the Media tab.`);
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(1) + " MB";
  console.log("\n──────── Summary ────────");
  console.log(`Cloudinary URLs found:   ${stats.found}`);
  console.log(`Migrated (new uploads):  ${stats.migrated}`);
  console.log(`Reused (already done):   ${stats.reused}`);
  console.log(`Failed:                  ${stats.failed}`);
  console.log(`Bytes downloaded:        ${mb(stats.bytesIn)}`);
  console.log(`Bytes stored on S3:      ${mb(stats.bytesOut)}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  ${f.url} — ${f.error}`));
  }
  if (DRY) console.log("\n(DRY RUN — no downloads, uploads, or DB writes performed.)");

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
