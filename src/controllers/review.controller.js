const mongoose = require("mongoose");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const Review = require("../models/Review");
const Product = require("../models/Product");
const Order = require("../models/Order");

/**
 * Recalculate a product's averageRating + reviewCount from approved reviews.
 * Pure helper, no side effects beyond Product.save().
 */
const recalculateProductStats = async (productId) => {
  const product = await Product.findById(productId);
  if (!product) return null;

  const stats = await Review.aggregate([
    {
      $match: {
        product: new mongoose.Types.ObjectId(productId),
        isApproved: true,
      },
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    product.averageRating = Math.round(stats[0].averageRating * 10) / 10;
    product.reviewCount = stats[0].reviewCount;
  } else {
    product.averageRating = 0;
    product.reviewCount = 0;
  }
  await product.save();
  return product;
};

const getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw ApiError.badRequest("Invalid product ID");
  }

  const productObjectId = new mongoose.Types.ObjectId(productId);

  const [reviews, totalReviews, ratingAgg, distributionAgg] = await Promise.all([
    Review.find({ product: productObjectId, isApproved: true })
      .populate("user", "fullName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments({ product: productObjectId, isApproved: true }),
    Review.aggregate([
      {
        $match: { product: productObjectId, isApproved: true },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
        },
      },
    ]),
    // Per-star distribution
    Review.aggregate([
      { $match: { product: productObjectId, isApproved: true } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);

  const averageRating =
    ratingAgg.length > 0 ? Math.round(ratingAgg[0].averageRating * 10) / 10 : 0;

  // Build a 1-5 distribution dict
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of distributionAgg) {
    distribution[d._id] = d.count;
  }

  res.status(200).json(
    new ApiResponse(200, {
      reviews,
      averageRating,
      totalReviews,
      distribution,
      page,
      totalPages: Math.ceil(totalReviews / limit),
    })
  );
});

const submitReview = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { productId, rating, title, text } = req.body;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw ApiError.badRequest("Invalid product ID");
  }

  // Check product exists
  const product = await Product.findById(productId);
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  // Check if user already reviewed this product
  const existingReview = await Review.findOne({
    user: userId,
    product: productId,
  });
  if (existingReview) {
    throw ApiError.conflict("You have already reviewed this product");
  }

  // Check if user has a delivered order containing this product
  const deliveredOrder = await Order.findOne({
    user: userId,
    status: "delivered",
    "items.product": productId,
  });

  const isVerified = !!deliveredOrder;

  const review = await Review.create({
    user: userId,
    product: productId,
    order: deliveredOrder ? deliveredOrder._id : undefined,
    rating,
    title,
    text,
    isVerifiedPurchase: isVerified,
    // Auto-approve verified-purchase reviews; hold others for admin moderation
    isApproved: isVerified,
  });

  // Recalculate product stats (only counts approved)
  await recalculateProductStats(productId);

  res.status(201).json(
    new ApiResponse(
      201,
      { review, requiresModeration: !isVerified },
      isVerified
        ? "Review submitted successfully"
        : "Review submitted! It will appear after admin approval."
    )
  );
});

// PATCH /api/reviews/:id (own review only)
const updateMyReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rating, title, text } = req.body;

  const review = await Review.findById(id);
  if (!review) throw ApiError.notFound("Review not found");
  if (review.user.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden("You can only edit your own review");
  }

  if (rating !== undefined) review.rating = rating;
  if (title !== undefined) review.title = title;
  if (text !== undefined) review.text = text;
  // Re-moderation: edits to non-verified reviews must be re-approved
  if (!review.isVerifiedPurchase) {
    review.isApproved = false;
  }
  await review.save();

  await recalculateProductStats(review.product);

  res.json(new ApiResponse(200, { review }, "Review updated"));
});

// DELETE /api/reviews/:id (own review only)
const deleteMyReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const review = await Review.findById(id);
  if (!review) throw ApiError.notFound("Review not found");
  if (review.user.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden("You can only delete your own review");
  }

  const productId = review.product;
  await review.deleteOne();
  await recalculateProductStats(productId);

  res.json(new ApiResponse(200, null, "Review deleted"));
});

// GET /api/reviews/me
const getMyReviews = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("product", "name slug images"),
    Review.countDocuments({ user: req.user._id }),
  ]);

  res.json(
    new ApiResponse(200, {
      reviews,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    })
  );
});

module.exports = {
  getProductReviews,
  submitReview,
  updateMyReview,
  deleteMyReview,
  getMyReviews,
  recalculateProductStats,
};
