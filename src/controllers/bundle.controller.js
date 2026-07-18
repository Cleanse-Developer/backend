const Bundle = require("../models/Bundle");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

const POPULATE_PRODUCTS = {
  path: "products",
  match: { isActive: true },
  select: "name slug price compareAtPrice images tag sizes",
};

// GET /api/bundles?product=<productId>
// Returns active bundles. If ?product= is provided, returns bundles that should display on that product page.
const listBundles = asyncHandler(async (req, res) => {
  const { product } = req.query;

  const filter = { isActive: true };

  if (product) {
    filter.displayOnProducts = product;
  }

  const bundles = await Bundle.find(filter)
    .populate(POPULATE_PRODUCTS)
    .sort({ priority: -1, createdAt: -1 })
    .lean();

  res.json(ApiResponse.ok({ bundles }));
});

// GET /api/bundles/featured
// The single bundle shown in the homepage "Build Your Ritual" section.
// Falls back to the highest-priority active bundle when nothing is flagged —
// keeps the section populated for data created before isFeatured existed.
const getFeaturedBundle = asyncHandler(async (req, res) => {
  const bundle =
    (await Bundle.findOne({ isActive: true, isFeatured: true })
      .populate(POPULATE_PRODUCTS)
      .lean()) ||
    (await Bundle.findOne({ isActive: true })
      .populate(POPULATE_PRODUCTS)
      .sort({ priority: -1, createdAt: -1 })
      .lean());

  res.json(ApiResponse.ok({ bundle: bundle || null }));
});

// GET /api/bundles/:slug
const getBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findOne({
    slug: req.params.slug,
    isActive: true,
  })
    .populate(POPULATE_PRODUCTS)
    .lean();

  if (!bundle) {
    throw ApiError.notFound("Bundle not found");
  }

  res.json(ApiResponse.ok({ bundle }));
});

module.exports = { listBundles, getFeaturedBundle, getBundle };
