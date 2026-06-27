const provider = require("./storage");
const env = require("../config/env");
const { toWebp, probe } = require("../utils/imageOptimize");
const Media = require("../models/Media");

// Vendor-neutral upload façade. Delegates to the active storage provider
// (Cloudinary or S3, chosen by STORAGE_PROVIDER). Each returns { url, publicId },
// where publicId is the provider's delete handle (Cloudinary public_id / S3 key).
//
// opts (all optional): { optimize, originalName, uploadedBy }
//   optimize    — convert images to WebP (~q82) before storing
//   originalName/uploadedBy — recorded on the Media registry doc

// Record a Media doc for the upload. Best-effort: never block/break the upload.
async function recordMedia(result, { folder, resourceType, mimetype, format, bytes, width, height, originalName, optimized, uploadedBy }) {
  try {
    await Media.create({
      url: result.url,
      publicId: result.publicId,
      provider: env.STORAGE_PROVIDER === "s3" ? "s3" : "cloudinary",
      folder: folder || "",
      resourceType,
      mimetype: mimetype || "",
      format: format || "",
      bytes: bytes || 0,
      width,
      height,
      originalName: originalName || "",
      optimized: !!optimized,
      uploadedBy: uploadedBy || undefined,
    });
  } catch (err) {
    // Duplicate publicId or DB hiccup — log and move on.
    console.error("Media registry record failed:", err.message);
  }
}

const uploadImage = async (fileBuffer, folder, mimetype, opts = {}) => {
  let buffer = fileBuffer;
  let mime = mimetype;
  let optimized = false;
  let dims = {};

  if (opts.optimize) {
    try {
      const webp = await toWebp(buffer);
      buffer = webp.buffer;
      mime = webp.mimetype;
      optimized = true;
      dims = { width: webp.width, height: webp.height, format: webp.format };
    } catch (err) {
      // Not a decodable image (or conversion failed) — fall back to the original.
      console.error("WebP optimize failed, using original:", err.message);
    }
  }
  if (!dims.width) dims = await probe(buffer);

  const result = await provider.uploadImage(buffer, folder, mime);
  await recordMedia(result, {
    folder,
    resourceType: "image",
    mimetype: mime,
    format: dims.format || "",
    bytes: buffer.length,
    width: dims.width,
    height: dims.height,
    originalName: opts.originalName,
    optimized,
    uploadedBy: opts.uploadedBy,
  });
  return result;
};

const uploadVideo = async (fileBuffer, folder, mimetype, opts = {}) => {
  const result = await provider.uploadVideo(fileBuffer, folder, mimetype);
  await recordMedia(result, {
    folder,
    resourceType: "video",
    mimetype,
    bytes: fileBuffer.length,
    originalName: opts.originalName,
    uploadedBy: opts.uploadedBy,
  });
  return result;
};

const deleteFile = (handle) => provider.remove(handle);

module.exports = { uploadImage, uploadVideo, deleteFile };
