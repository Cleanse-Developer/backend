const Category = require("../models/Category");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

// GET /api/categories
const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .select("-__v")
    .lean();

  res.json(ApiResponse.ok({ categories }, "Categories fetched successfully"));
});

module.exports = { listCategories };
