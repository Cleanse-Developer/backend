const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const Review = require("../models/Review");
const Product = require("../models/Product");
const Order = require("../models/Order");

const getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const [reviews, totalReviews, ratingAgg] = await Promise.all([
    Review.find({ product: productId, isApproved: true })
      .populate("user", "fullName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments({ product: productId, isApproved: true }),
    Review.aggregate([
      {
        $match: {
          product: require("mongoose").Types.ObjectId.createFromHexString(productId),
          isApproved: true,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
        },
      },
    ]),
  ]);

  const averageRating =
    ratingAgg.length > 0 ? Math.round(ratingAgg[0].averageRating * 10) / 10 : 0;

  res.status(200).json(
    new ApiResponse(200, {
      reviews,
      averageRating,
      totalReviews,
      page,
      totalPages: Math.ceil(totalReviews / limit),
    })
  );
});

const submitReview = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { productId, rating, title, text } = req.body;

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

  const review = await Review.create({
    user: userId,
    product: productId,
    order: deliveredOrder ? deliveredOrder._id : undefined,
    rating,
    title,
    text,
    isVerifiedPurchase: !!deliveredOrder,
  });

  // Update product averageRating and reviewCount
  const stats = await Review.aggregate([
    {
      $match: {
        product: product._id,
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
    await product.save();
  }

  res
    .status(201)
    .json(new ApiResponse(201, review, "Review submitted successfully"));
});

module.exports = { getProductReviews, submitReview };
