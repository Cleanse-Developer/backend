const Media = require("../../models/Media");
const { uploadImage, uploadVideo } = require("../../services/upload.service");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { paginationMeta } = require("../../utils/pagination");

const MEDIA_FOLDER = "media-library";

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  largest: { bytes: -1 },
  smallest: { bytes: 1 },
  name: { originalName: 1 },
};

// GET /api/admin/media
const listMedia = asyncHandler(async (req, res) => {
  const { page = 1, limit = 40, search, type, provider, sort = "newest" } = req.query;

  const filter = { hidden: { $ne: true } };
  if (type === "image" || type === "video") filter.resourceType = type;
  if (provider === "s3" || provider === "cloudinary") filter.provider = provider;
  if (search) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ originalName: rx }, { folder: rx }, { url: rx }];
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;
  const sortSpec = SORT_MAP[sort] || SORT_MAP.newest;

  const [media, total] = await Promise.all([
    Media.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(limitNum)
      .populate("uploadedBy", "name email")
      .lean(),
    Media.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      media,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/media/:id
const getMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id)
    .populate("uploadedBy", "name email")
    .lean();
  if (!media) throw ApiError.notFound("Media not found");
  res.json(ApiResponse.ok(media));
});

// POST /api/admin/media  (field: "file")
const uploadMediaAsset = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No file provided");

  const isVideo = req.file.mimetype.startsWith("video/");
  const opts = {
    optimize: req.body.optimize === "true",
    originalName: req.file.originalname,
    uploadedBy: req.user?._id,
  };

  const result = isVideo
    ? await uploadVideo(req.file.buffer, MEDIA_FOLDER, req.file.mimetype, opts)
    : await uploadImage(req.file.buffer, MEDIA_FOLDER, req.file.mimetype, opts);

  // upload.service already recorded the Media doc — return it (freshly fetched).
  const media = await Media.findOne({ publicId: result.publicId })
    .populate("uploadedBy", "name email")
    .lean();

  res.status(201).json(ApiResponse.created(media || result, "Media uploaded"));
});

module.exports = { listMedia, getMedia, uploadMediaAsset };
