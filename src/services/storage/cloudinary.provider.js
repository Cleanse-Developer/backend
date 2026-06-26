const cloudinary = require("../../config/cloudinary");

// Cloudinary storage provider. `mimetype` is accepted for interface parity with
// the S3 provider but unused (Cloudinary infers it). Returns { url, publicId }.

const upload = (fileBuffer, folder, resourceType) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(fileBuffer);
  });

const uploadImage = (fileBuffer, folder, _mimetype) =>
  upload(fileBuffer, folder, "image");

const uploadVideo = (fileBuffer, folder, _mimetype) =>
  upload(fileBuffer, folder, "video");

// handle = Cloudinary public_id
const remove = async (handle) => {
  if (!handle) return;
  await cloudinary.uploader.destroy(handle);
};

module.exports = { uploadImage, uploadVideo, remove };
