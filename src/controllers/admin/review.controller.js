const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const Review = require("../../models/Review");
const { paginationMeta } = require("../../utils/pagination");
const {
  recalculateProductStats,
} = require("../review.controller");

// GET /api/admin/reviews
const listReviews = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const status = req.query.status; // "pending" | "approved" | undefined
  const productId = req.query.productId;

  const filter = {};
  if (status === "pending") filter.isApproved = false;
  else if (status === "approved") filter.isApproved = true;
  if (productId) filter.product = productId;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "fullName email")
      .populate("product", "name slug")
      .lean(),
    Review.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      reviews,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// GET /api/admin/reviews/stats
const getStats = asyncHandler(async (req, res) => {
  const [pending, approved, total] = await Promise.all([
    Review.countDocuments({ isApproved: false }),
    Review.countDocuments({ isApproved: true }),
    Review.countDocuments({}),
  ]);
  res.json(ApiResponse.ok({ pending, approved, total }));
});

// PATCH /api/admin/reviews/:id/approve
const approveReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound("Review not found");
  if (review.isApproved) {
    return res.json(ApiResponse.ok({ review }, "Already approved"));
  }
  review.isApproved = true;
  await review.save();
  await recalculateProductStats(review.product);
  res.json(ApiResponse.ok({ review }, "Review approved"));
});

// DELETE /api/admin/reviews/:id
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound("Review not found");
  const productId = review.product;
  await review.deleteOne();
  await recalculateProductStats(productId);
  res.json(ApiResponse.ok(null, "Review deleted"));
});

module.exports = { listReviews, getStats, approveReview, deleteReview };
