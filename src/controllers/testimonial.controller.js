const Testimonial = require("../models/Testimonial");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

// GET /api/testimonials
const listTestimonials = asyncHandler(async (req, res) => {
  const { type, limit = 10 } = req.query;

  const filter = { isActive: true };

  if (type) {
    // "before-after" returns items typed "before-after" or "both"
    if (type === "before-after") {
      filter.type = { $in: ["before-after", "both"] };
    } else {
      filter.type = type;
    }
  }

  const limitNum = Math.min(50, Math.max(1, Number(limit)));

  const testimonials = await Testimonial.find(filter)
    .sort({ sortOrder: 1, createdAt: -1 })
    .limit(limitNum)
    .select("-__v")
    .lean();

  res.json(ApiResponse.ok({ testimonials }, "Testimonials fetched successfully"));
});

module.exports = { listTestimonials };
