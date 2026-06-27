/**
 * Backfill the Media registry from existing storage providers.
 * Imports every object already in S3 + Cloudinary into the Media collection so the
 * admin Media Library shows historical uploads (not just new ones).
 *
 * Idempotent — upserts by publicId, safe to re-run.
 *
 * Usage: node scripts/backfill-media.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const cloudinary = require("../src/config/cloudinary");
const s3Client = require("../src/config/s3");
const env = require("../src/config/env");
const Media = require("../src/models/Media");

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "avif", "svg"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "m4v"];

const extOf = (key) => (key.split(".").pop() || "").toLowerCase();
const resourceTypeFromExt = (key) =>
  VIDEO_EXTS.includes(extOf(key)) ? "video" : "image";

async function upsert(doc) {
  // timestamps:false so our historical createdAt isn't clobbered by / conflicting with
  // mongoose's auto-timestamp on upsert.
  await Media.updateOne(
    { publicId: doc.publicId },
    { $setOnInsert: { ...doc, updatedAt: doc.createdAt } },
    { upsert: true, timestamps: false }
  );
}

async function backfillS3() {
  if (!env.AWS_S3_BUCKET || !env.CLOUDFRONT_URL) {
    console.log("S3: skipped (AWS_S3_BUCKET / CLOUDFRONT_URL not set)");
    return 0;
  }
  const base = env.CLOUDFRONT_URL.replace(/\/+$/, "");
  let token;
  let count = 0;
  do {
    const out = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: env.AWS_S3_BUCKET,
        ContinuationToken: token,
      })
    );
    for (const obj of out.Contents || []) {
      const key = obj.Key;
      if (!key || key.endsWith("/")) continue; // skip folder markers
      const folder = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      await upsert({
        url: `${base}/${key}`,
        publicId: key,
        provider: "s3",
        folder,
        resourceType: resourceTypeFromExt(key),
        format: extOf(key),
        bytes: obj.Size || 0,
        originalName: key.split("/").pop(),
        createdAt: obj.LastModified || new Date(),
      });
      count++;
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  console.log(`S3: imported/seen ${count} objects`);
  return count;
}

async function backfillCloudinaryType(resourceType) {
  let cursor;
  let count = 0;
  do {
    const res = await cloudinary.api.resources({
      type: "upload",
      resource_type: resourceType,
      max_results: 500,
      next_cursor: cursor,
    });
    for (const r of res.resources || []) {
      const publicId = r.public_id + (r.format ? `.${r.format}` : "");
      const folder = r.public_id.includes("/")
        ? r.public_id.slice(0, r.public_id.lastIndexOf("/"))
        : "";
      await upsert({
        url: r.secure_url,
        publicId, // include ext so it won't collide with the S3 key space
        provider: "cloudinary",
        folder,
        resourceType: resourceType === "video" ? "video" : "image",
        format: r.format || "",
        bytes: r.bytes || 0,
        width: r.width,
        height: r.height,
        originalName: (r.public_id.split("/").pop() || "") + (r.format ? `.${r.format}` : ""),
        createdAt: r.created_at ? new Date(r.created_at) : new Date(),
      });
      count++;
    }
    cursor = res.next_cursor;
  } while (cursor);
  return count;
}

async function backfillCloudinary() {
  if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    console.log("Cloudinary: skipped (API key/secret not set)");
    return 0;
  }
  let total = 0;
  for (const rt of ["image", "video"]) {
    try {
      const n = await backfillCloudinaryType(rt);
      console.log(`Cloudinary (${rt}): imported/seen ${n} resources`);
      total += n;
    } catch (err) {
      console.error(`Cloudinary (${rt}) failed:`, err.message);
    }
  }
  return total;
}

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Mongo connected. Backfilling media registry...\n");
  const before = await Media.countDocuments();
  try {
    await backfillS3();
  } catch (err) {
    if (err.name === "AccessDenied" || err.Code === "AccessDenied") {
      console.warn(
        "S3: AccessDenied — the IAM user lacks s3:ListBucket. Add it to enumerate " +
          "existing S3 objects (Resource: arn:aws:s3:::" + env.AWS_S3_BUCKET + "). " +
          "Skipping S3 backfill; new uploads are still recorded automatically."
      );
    } else {
      console.error("S3 backfill error:", err.message);
    }
  }
  await backfillCloudinary();
  const after = await Media.countDocuments();
  console.log(`\nDone. Media docs: ${before} -> ${after} (+${after - before} new)`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
