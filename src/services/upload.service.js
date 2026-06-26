const provider = require("./storage");

// Vendor-neutral upload façade. Delegates to the active storage provider
// (Cloudinary or S3, chosen by STORAGE_PROVIDER). Each returns { url, publicId },
// where publicId is the provider's delete handle (Cloudinary public_id / S3 key).

const uploadImage = (fileBuffer, folder, mimetype) =>
  provider.uploadImage(fileBuffer, folder, mimetype);

const uploadVideo = (fileBuffer, folder, mimetype) =>
  provider.uploadVideo(fileBuffer, folder, mimetype);

const deleteFile = (handle) => provider.remove(handle);

module.exports = { uploadImage, uploadVideo, deleteFile };
