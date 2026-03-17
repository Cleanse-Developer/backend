const Bundle = require("../../models/Bundle");
const Product = require("../../models/Product");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");

// GET /api/admin/bundles
const listBundles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;

  const filter = {};

  if (status === "active") {
    filter.isActive = true;
  } else if (status === "inactive") {
    filter.isActive = false;
  }

  if (search) {
    filter.name = { $regex: search, $options: "i" };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [bundles, total] = await Promise.all([
    Bundle.find(filter)
      .populate("products", "name slug price images isActive")
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Bundle.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      bundles,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/bundles/:id
const getBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id)
    .populate("products", "name slug price images isActive tag sizes")
    .populate("displayOnProducts", "name slug")
    .lean();

  if (!bundle) {
    throw ApiError.notFound("Bundle not found");
  }

  res.json(ApiResponse.ok({ bundle }));
});

// POST /api/admin/bundles
const createBundle = asyncHandler(async (req, res) => {
  const {
    name,
    slug,
    description,
    subtitle,
    products,
    discountType,
    discountValue,
    minProducts,
    displayOnProducts,
    isActive,
    priority,
    image,
  } = req.body;

  if (!name || !slug || !products || !discountType || discountValue == null) {
    throw ApiError.badRequest(
      "name, slug, products, discountType, and discountValue are required"
    );
  }

  if (!products.length || products.length < 2) {
    throw ApiError.badRequest("A bundle must contain at least 2 products");
  }

  // Validate that all products exist
  const productCount = await Product.countDocuments({
    _id: { $in: products },
    isActive: true,
  });
  if (productCount !== products.length) {
    throw ApiError.badRequest("One or more products are invalid or inactive");
  }

  // Check slug uniqueness
  const existing = await Bundle.findOne({ slug });
  if (existing) {
    throw ApiError.conflict(`Bundle with slug "${slug}" already exists`);
  }

  // Validate discount
  if (discountType === "percentage" && discountValue > 100) {
    throw ApiError.badRequest("Percentage discount cannot exceed 100%");
  }

  const bundle = await Bundle.create({
    name,
    slug,
    description,
    subtitle,
    products,
    discountType,
    discountValue,
    minProducts: minProducts || 3,
    displayOnProducts: displayOnProducts || products, // default: show on all bundle products
    isActive: isActive !== undefined ? isActive : true,
    priority: priority || 0,
    image,
  });

  await bundle.populate("products", "name slug price images");

  res.status(201).json(ApiResponse.created({ bundle }, "Bundle created"));
});

// PATCH /api/admin/bundles/:id
const updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) {
    throw ApiError.notFound("Bundle not found");
  }

  const allowedFields = [
    "name",
    "slug",
    "description",
    "subtitle",
    "products",
    "discountType",
    "discountValue",
    "minProducts",
    "displayOnProducts",
    "isActive",
    "priority",
    "image",
  ];

  // Validate slug uniqueness if changed
  if (req.body.slug && req.body.slug !== bundle.slug) {
    const existing = await Bundle.findOne({ slug: req.body.slug });
    if (existing) {
      throw ApiError.conflict(
        `Bundle with slug "${req.body.slug}" already exists`
      );
    }
  }

  // Validate products if changed
  if (req.body.products) {
    if (req.body.products.length < 2) {
      throw ApiError.badRequest("A bundle must contain at least 2 products");
    }
    const productCount = await Product.countDocuments({
      _id: { $in: req.body.products },
      isActive: true,
    });
    if (productCount !== req.body.products.length) {
      throw ApiError.badRequest(
        "One or more products are invalid or inactive"
      );
    }
  }

  // Validate discount
  const effectiveDiscountType = req.body.discountType ?? bundle.discountType;
  const effectiveDiscountValue = req.body.discountValue ?? bundle.discountValue;
  if (effectiveDiscountType === "percentage" && effectiveDiscountValue > 100) {
    throw ApiError.badRequest("Percentage discount cannot exceed 100%");
  }

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      bundle[field] = req.body[field];
    }
  }

  await bundle.save();
  await bundle.populate("products", "name slug price images");

  res.json(ApiResponse.ok({ bundle }, "Bundle updated"));
});

// DELETE /api/admin/bundles/:id
const deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findByIdAndDelete(req.params.id);
  if (!bundle) {
    throw ApiError.notFound("Bundle not found");
  }

  res.json(ApiResponse.ok(null, "Bundle deleted"));
});

module.exports = { listBundles, getBundle, createBundle, updateBundle, deleteBundle };
