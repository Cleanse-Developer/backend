const sharp = require("sharp");

// Convert an image buffer to WebP at visually-lossless quality (~q82).
// Returns the new buffer + metadata. Throws if the buffer is not a decodable image.
async function toWebp(buffer) {
  const { data, info } = await sharp(buffer)
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    mimetype: "image/webp",
    format: "webp",
    width: info.width,
    height: info.height,
  };
}

// Best-effort dimensions/format probe. Returns {} for non-images or on failure.
async function probe(buffer) {
  try {
    const m = await sharp(buffer).metadata();
    return { width: m.width, height: m.height, format: m.format };
  } catch {
    return {};
  }
}

module.exports = { toWebp, probe };
