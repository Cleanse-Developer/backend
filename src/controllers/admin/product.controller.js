const Product = require("../../models/Product");
const { uploadToCloudinary } = require("../../services/upload.service");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { paginationMeta } = require("../../utils/pagination");

// GET /api/admin/products
const listProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    tag,
    status,
    sort = "-createdAt",
  } = req.query;

  const filter = {};

  if (search) {
    filter.$text = { $search: search };
  }

  if (tag) {
    filter.tag = tag;
  }

  if (status === "active") {
    filter.isActive = true;
  } else if (status === "draft") {
    filter.isActive = false;
  } else if (status === "archived") {
    filter.isActive = false;
  }

  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate("category", "name slug")
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      products,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// POST /api/admin/products
const createProduct = asyncHandler(async (req, res) => {
  const productData = req.body;

  // Handle image uploads
  if (req.files && req.files.length > 0) {
    const imageUploads = await Promise.all(
      req.files.map((file) =>
        uploadToCloudinary(file.buffer, "cleanse-ayurveda/products")
      )
    );

    productData.images = imageUploads.map((img, index) => ({
      url: img.url,
      alt: productData.name || "Product image",
      isPrimary: index === 0,
    }));
  }

  // Parse sizes if sent as JSON string
  if (typeof productData.sizes === "string") {
    productData.sizes = JSON.parse(productData.sizes);
  }

  // Parse seo if sent as JSON string
  if (typeof productData.seo === "string") {
    productData.seo = JSON.parse(productData.seo);
  }

  const product = await Product.create(productData);

  res.status(201).json(ApiResponse.created(product, "Product created"));
});

// GET /api/admin/products/:id
const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate("category", "name slug")
    .lean();

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  res.json(ApiResponse.ok(product));
});

// PATCH /api/admin/products/:id
const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const updateData = req.body;

  // Handle new image uploads
  if (req.files && req.files.length > 0) {
    const imageUploads = await Promise.all(
      req.files.map((file) =>
        uploadToCloudinary(file.buffer, "cleanse-ayurveda/products")
      )
    );

    const newImages = imageUploads.map((img) => ({
      url: img.url,
      alt: updateData.name || product.name || "Product image",
      isPrimary: false,
    }));

    // Append new images to existing ones
    updateData.images = [...(product.images || []), ...newImages];
  }

  // Parse sizes if sent as JSON string
  if (typeof updateData.sizes === "string") {
    updateData.sizes = JSON.parse(updateData.sizes);
  }

  // Parse seo if sent as JSON string
  if (typeof updateData.seo === "string") {
    updateData.seo = JSON.parse(updateData.seo);
  }

  Object.assign(product, updateData);
  await product.save();

  res.json(ApiResponse.ok(product, "Product updated"));
});

// DELETE /api/admin/products/:id
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  product.isActive = false;
  await product.save();

  res.json(ApiResponse.ok(null, "Product deleted"));
});

module.exports = {
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
};
