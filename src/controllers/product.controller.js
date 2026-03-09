const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { paginationMeta } = require("../utils/pagination");

// GET /api/products
const listProducts = asyncHandler(async (req, res) => {
  const {
    tag,
    sort,
    priceRange,
    page = 1,
    limit = 20,
    q,
  } = req.query;

  const filter = { isActive: true };

  // Tag filter
  if (tag) {
    filter.tag = tag;
  }

  // Price range filter
  if (priceRange) {
    switch (priceRange) {
      case "under-500":
        filter.price = { $lt: 500 };
        break;
      case "500-1000":
        filter.price = { $gte: 500, $lte: 1000 };
        break;
      case "above-1000":
        filter.price = { $gt: 1000 };
        break;
    }
  }

  // Text search filter
  if (q) {
    filter.$text = { $search: q };
  }

  // Sort options
  let sortOption = { createdAt: -1 };
  if (sort) {
    switch (sort) {
      case "price-low":
        sortOption = { price: 1 };
        break;
      case "price-high":
        sortOption = { price: -1 };
        break;
      case "name-az":
        sortOption = { name: 1 };
        break;
      case "name-za":
        sortOption = { name: -1 };
        break;
      case "featured":
        sortOption = { isFeatured: -1, createdAt: -1 };
        break;
    }
  }

  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(Number(limit))
      .select("-__v"),
    Product.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      products,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// GET /api/products/:slug
const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    slug: req.params.slug,
    isActive: true,
  })
    .populate("category", "name slug")
    .select("-__v");

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  res.json(ApiResponse.ok({ product }));
});

// GET /api/products/:id/related
const getRelatedProducts = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  // Find related products from same category or tag, excluding the current one
  const matchConditions = [];
  if (product.category) {
    matchConditions.push({ category: product.category });
  }
  matchConditions.push({ tag: product.tag });

  const related = await Product.aggregate([
    {
      $match: {
        _id: { $ne: product._id },
        isActive: true,
        $or: matchConditions,
      },
    },
    { $sample: { size: 4 } },
    {
      $project: {
        __v: 0,
      },
    },
  ]);

  res.json(ApiResponse.ok({ products: related }));
});

// GET /api/products/search?q=
const searchProducts = asyncHandler(async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;

  if (!q) {
    throw ApiError.badRequest("Search query is required");
  }

  const filter = {
    isActive: true,
    $text: { $search: q },
  };

  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(filter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(Number(limit))
      .select("-__v"),
    Product.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      products,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

module.exports = { listProducts, getProduct, getRelatedProducts, searchProducts };
