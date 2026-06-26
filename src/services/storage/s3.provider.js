const crypto = require("crypto");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = require("../../config/s3");
const env = require("./../../config/env");

// AWS S3 storage provider, served via CloudFront. Returns { url, publicId } where
// publicId is the S3 object key (also the delete handle) — same shape as Cloudinary.

// Best-effort file extension from MIME type; falls back to "bin".
const extFromMime = (mimetype) => {
  if (!mimetype || !mimetype.includes("/")) return "bin";
  const sub = mimetype.split("/")[1].toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  if (sub === "quicktime") return "mov";
  return sub.replace(/[^a-z0-9]/g, "") || "bin";
};

const put = async (fileBuffer, folder, mimetype) => {
  const key = `${folder}/${crypto.randomUUID()}.${extFromMime(mimetype)}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimetype || "application/octet-stream",
    })
  );
  const base = env.CLOUDFRONT_URL.replace(/\/+$/, "");
  return { url: `${base}/${key}`, publicId: key };
};

const uploadImage = (fileBuffer, folder, mimetype) => put(fileBuffer, folder, mimetype);
const uploadVideo = (fileBuffer, folder, mimetype) => put(fileBuffer, folder, mimetype);

// handle = S3 object key
const remove = async (handle) => {
  if (!handle) return;
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: handle })
  );
};

module.exports = { uploadImage, uploadVideo, remove };
