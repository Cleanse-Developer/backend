const Product = require("../../models/Product");
const { uploadImage } = require("../../services/upload.service");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { paginationMeta } = require("../../utils/pagination");
const {
  resolveProductImages,
  filesByFieldName,
} = require("../../utils/imageVariants");

const PRODUCT_IMAGE_FOLDER = "cleanse-ayurveda/products";

// Resolve the `images` metadata array (+ keyed variant files from upload.any())
// into the stored images[] shape. Legacy fallback: bare files with no metadata
// become base images appended to any existing ones.
async function applyProductImages(data, req, existingImages = []) {
  const fileMap = filesByFieldName(req.files);

  let metadata;
  if (typeof data.images === "string") metadata = JSON.parse(data.images);
  else if (Array.isArray(data.images)) metadata = data.images;

  if (Array.isArray(metadata)) {
    data.images = await resolveProductImages(metadata, fileMap, PRODUCT_IMAGE_FOLDER);
    return;
  }

  const files = req.files || [];
  if (files.length > 0) {
    const uploads = await Promise.all(
      files.map((f) => uploadImage(f.buffer, PRODUCT_IMAGE_FOLDER, f.mimetype))
    );
    const base = existingImages.length ? [...existingImages] : [];
    const newImages = uploads.map((img, i) => ({
      url: img.url,
      alt: data.name || "Product image",
      isPrimary: base.length === 0 && i === 0,
    }));
    data.images = [...base, ...newImages];
  } else {
    delete data.images;
  }
}

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

  if (req.query.deleted === "true") {
    filter.isDeleted = true;
  } else {
    filter.isDeleted = { $ne: true };
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

  // Resolve images metadata + variant files
  await applyProductImages(productData, req);

  // Parse sizes if sent as JSON string
  if (typeof productData.sizes === "string") {
    productData.sizes = JSON.parse(productData.sizes);
  }

  // Parse seo if sent as JSON string
  if (typeof productData.seo === "string") {
    productData.seo = JSON.parse(productData.seo);
  }

  // Parse tabHighlights if sent as JSON string
  if (typeof productData.tabHighlights === "string") {
    productData.tabHighlights = JSON.parse(productData.tabHighlights);
  }

  // Parse array fields if sent as JSON strings
  for (const key of ["benefits", "skinType", "concerns"]) {
    if (typeof productData[key] === "string") {
      productData[key] = JSON.parse(productData[key]);
    }
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

  // Resolve images metadata + variant files (legacy fallback appends to existing)
  await applyProductImages(updateData, req, product.images || []);

  // Parse sizes if sent as JSON string
  if (typeof updateData.sizes === "string") {
    updateData.sizes = JSON.parse(updateData.sizes);
  }

  // Parse seo if sent as JSON string
  if (typeof updateData.seo === "string") {
    updateData.seo = JSON.parse(updateData.seo);
  }

  // Parse tabHighlights if sent as JSON string
  if (typeof updateData.tabHighlights === "string") {
    updateData.tabHighlights = JSON.parse(updateData.tabHighlights);
  }

  // Parse array fields if sent as JSON strings
  for (const key of ["benefits", "skinType", "concerns"]) {
    if (typeof updateData[key] === "string") {
      updateData[key] = JSON.parse(updateData[key]);
    }
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

  product.isDeleted = true;
  product.deletedAt = new Date();
  await product.save();

  res.json(ApiResponse.ok(null, "Product deleted"));
});

// PATCH /api/admin/products/:id/restore
const restoreProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  product.isDeleted = false;
  product.deletedAt = null;
  await product.save();

  res.json(ApiResponse.ok(null, "Product restored"));
});

module.exports = {
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
};
