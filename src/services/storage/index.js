const env = require("../../config/env");

// Select the active storage provider by env flag. Both expose the same interface:
//   uploadImage(buffer, folder, mimetype) -> { url, publicId }
//   uploadVideo(buffer, folder, mimetype) -> { url, publicId }
//   remove(handle) -> Promise<void>
// Flip STORAGE_PROVIDER in .env to switch — no other code changes.
const provider =
  env.STORAGE_PROVIDER === "s3"
    ? require("./s3.provider")
    : require("./cloudinary.provider");

module.exports = provider;
