const Settings = require("../../models/Settings");
const { uploadImage, uploadVideo } = require("../../services/upload.service");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const { invalidateSettingsCache } = require("../settings.controller");

const CMS_KEYS = [
  // Top promo/announcement bar — stored under the existing public "promoBanner"
  // settings key so the storefront reads it with no extra wiring.
  "promoBanner",
  "cmsHero",
  "cmsFormula",
  "cmsMarquee",
  "cmsBento",
  "cmsCta",
  "cmsPeelReveal",
  "cmsHeader",
  "cmsFooter",
  "cmsTerms",
  "cmsPrivacy",
];

// POST /api/admin/cms/upload-image
const uploadCmsImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "No image file provided");
  }

  const result = await uploadImage(req.file.buffer, "cleanse/cms", req.file.mimetype, {
    optimize: req.body.optimize === "true",
    originalName: req.file.originalname,
    uploadedBy: req.user?._id,
  });
  res.json(ApiResponse.ok(result, "Image uploaded successfully"));
});

// POST /api/admin/cms/upload-video
const uploadCmsVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "No video file provided");
  }

  const result = await uploadVideo(req.file.buffer, "cleanse/cms", req.file.mimetype, {
    originalName: req.file.originalname,
    uploadedBy: req.user?._id,
  });
  res.json(ApiResponse.ok(result, "Video uploaded successfully"));
});

// GET /api/admin/cms/:key
const getCmsSection = asyncHandler(async (req, res) => {
  const { key } = req.params;

  if (!CMS_KEYS.includes(key)) {
    throw new ApiError(400, `Invalid CMS section key: ${key}`);
  }

  const doc = await Settings.findOne({ key }).lean();
  res.json(ApiResponse.ok(doc ? doc.value : null));
});

// PATCH /api/admin/cms/:key
const updateCmsSection = asyncHandler(async (req, res) => {
  const { key } = req.params;

  if (!CMS_KEYS.includes(key)) {
    throw new ApiError(400, `Invalid CMS section key: ${key}`);
  }

  const value = req.body;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }

  await Settings.findOneAndUpdate(
    { key },
    { $set: { key, value } },
    { upsert: true, new: true }
  );

  invalidateSettingsCache();

  const updated = await Settings.findOne({ key }).lean();
  res.json(ApiResponse.ok(updated.value, "CMS section updated successfully"));
});

module.exports = {
  uploadCmsImage,
  uploadCmsVideo,
  getCmsSection,
  updateCmsSection,
};
