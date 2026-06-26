const Category = require("../../models/Category");
const Product = require("../../models/Product");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { uploadImage } = require("../../services/upload.service");

// Resolve a banner field: a newly uploaded file wins, otherwise fall back to
// the string sent in the body (existing URL to keep, or "" to clear).
async function resolveBanner(req, field) {
  const file = req.files?.[field]?.[0];
  if (file) {
    const uploaded = await uploadImage(file.buffer, "categories", file.mimetype);
    return uploaded.url;
  }
  if (typeof req.body[field] === "string") {
    return req.body[field];
  }
  return undefined;
}

// GET /api/admin/categories
const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.aggregate([
    { $sort: { sortOrder: 1 } },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "category",
        as: "products",
      },
    },
    {
      $addFields: {
        productCount: { $size: "$products" },
      },
    },
    {
      $project: {
        products: 0,
      },
    },
  ]);

  res.json(ApiResponse.ok(categories));
});

// POST /api/admin/categories
const createCategory = asyncHandler(async (req, res) => {
  const { name, description, parent, sortOrder } = req.body;

  if (!name) {
    throw ApiError.badRequest("Category name is required");
  }

  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  const existing = await Category.findOne({ slug });
  if (existing) {
    throw ApiError.conflict("A category with this name already exists");
  }

  const bannerTop = await resolveBanner(req, "bannerTop");
  const bannerBottom = await resolveBanner(req, "bannerBottom");

  const category = await Category.create({
    name,
    slug,
    description,
    bannerTop,
    bannerBottom,
    parent: parent || null,
    sortOrder: Number(sortOrder) || 0,
  });

  res.status(201).json(ApiResponse.created(category, "Category created"));
});

// PATCH /api/admin/categories/:id
const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    throw ApiError.notFound("Category not found");
  }

  const { name, description, parent, sortOrder, isActive } = req.body;

  if (name && name !== category.name) {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

    const existing = await Category.findOne({ slug, _id: { $ne: category._id } });
    if (existing) {
      throw ApiError.conflict("A category with this name already exists");
    }

    category.name = name;
    category.slug = slug;
  }

  const bannerTop = await resolveBanner(req, "bannerTop");
  const bannerBottom = await resolveBanner(req, "bannerBottom");

  if (description !== undefined) category.description = description;
  if (bannerTop !== undefined) category.bannerTop = bannerTop;
  if (bannerBottom !== undefined) category.bannerBottom = bannerBottom;
  if (parent !== undefined) category.parent = parent || null;
  if (sortOrder !== undefined) category.sortOrder = Number(sortOrder) || 0;
  if (isActive !== undefined) category.isActive = isActive === true || isActive === "true";

  await category.save();

  res.json(ApiResponse.ok(category, "Category updated"));
});

// DELETE /api/admin/categories/:id
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    throw ApiError.notFound("Category not found");
  }

  const productCount = await Product.countDocuments({ category: category._id });
  if (productCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete category. ${productCount} product(s) are still assigned to it.`
    );
  }

  await Category.findByIdAndDelete(category._id);

  res.json(ApiResponse.ok(null, "Category deleted"));
});

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
