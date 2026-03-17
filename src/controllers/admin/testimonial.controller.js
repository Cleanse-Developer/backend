const Testimonial = require("../../models/Testimonial");
const { uploadToCloudinary } = require("../../services/upload.service");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { paginationMeta } = require("../../utils/pagination");

// GET /api/admin/testimonials/:id
const getTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await Testimonial.findById(req.params.id).lean();
  if (!testimonial) throw ApiError.notFound("Testimonial not found");
  res.json(ApiResponse.ok(testimonial));
});

// GET /api/admin/testimonials
const listTestimonials = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;

  const filter = {};
  if (type) filter.type = type;

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [testimonials, total] = await Promise.all([
    Testimonial.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Testimonial.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      testimonials,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// POST /api/admin/testimonials
const createTestimonial = asyncHandler(async (req, res) => {
  const {
    name,
    role,
    headline,
    text,
    beforeImage,
    afterImage,
    type,
    rating,
    product,
    productName,
    sortOrder,
    isActive,
  } = req.body;

  if (!name || !headline || !text) {
    throw ApiError.badRequest("name, headline, and text are required");
  }

  const data = {
    name,
    role,
    headline,
    text,
    type: type || "review",
    rating: rating ? Number(rating) : 5,
    product: product || undefined,
    productName,
    sortOrder: sortOrder ? Number(sortOrder) : 0,
    isActive: isActive !== undefined ? isActive === "true" || isActive === true : true,
  };

  // Handle image: file upload takes priority over URL string, per field independently
  if (req.files && req.files.beforeImage) {
    const uploaded = await uploadToCloudinary(
      req.files.beforeImage[0].buffer,
      "cleanse-ayurveda/testimonials"
    );
    data.beforeImage = uploaded.url;
  } else if (beforeImage) {
    data.beforeImage = beforeImage;
  }

  if (req.files && req.files.afterImage) {
    const uploaded = await uploadToCloudinary(
      req.files.afterImage[0].buffer,
      "cleanse-ayurveda/testimonials"
    );
    data.afterImage = uploaded.url;
  } else if (afterImage) {
    data.afterImage = afterImage;
  }

  const testimonial = await Testimonial.create(data);

  res.status(201).json(ApiResponse.created(testimonial, "Testimonial created"));
});

// Fields that should never be overwritten via PATCH body
const INTERNAL_FIELDS = ["_id", "__v", "createdAt", "updatedAt"];

// PATCH /api/admin/testimonials/:id
const updateTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await Testimonial.findById(req.params.id);
  if (!testimonial) {
    throw ApiError.notFound("Testimonial not found");
  }

  const updateData = { ...req.body };

  // Strip internal/protected fields
  for (const field of INTERNAL_FIELDS) {
    delete updateData[field];
  }

  if (updateData.rating !== undefined) updateData.rating = Number(updateData.rating);
  if (updateData.sortOrder !== undefined) updateData.sortOrder = Number(updateData.sortOrder);
  if (updateData.isActive !== undefined) {
    updateData.isActive = updateData.isActive === "true" || updateData.isActive === true;
  }

  // Handle image uploads — file upload takes priority over URL string per field
  if (req.files && req.files.beforeImage) {
    const uploaded = await uploadToCloudinary(
      req.files.beforeImage[0].buffer,
      "cleanse-ayurveda/testimonials"
    );
    updateData.beforeImage = uploaded.url;
  }
  // If no file uploaded for beforeImage, body URL (if any) is already in updateData

  if (req.files && req.files.afterImage) {
    const uploaded = await uploadToCloudinary(
      req.files.afterImage[0].buffer,
      "cleanse-ayurveda/testimonials"
    );
    updateData.afterImage = uploaded.url;
  }
  // If no file uploaded for afterImage, body URL (if any) is already in updateData

  Object.assign(testimonial, updateData);
  await testimonial.save();

  res.json(ApiResponse.ok(testimonial, "Testimonial updated"));
});

// DELETE /api/admin/testimonials/:id
const deleteTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await Testimonial.findById(req.params.id);
  if (!testimonial) {
    throw ApiError.notFound("Testimonial not found");
  }

  await Testimonial.findByIdAndDelete(req.params.id);

  res.json(ApiResponse.ok(null, "Testimonial deleted"));
});

module.exports = {
  getTestimonial,
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
};
