const { Router } = require("express");
const {
  listProducts,
  getProduct,
  getRelatedProducts,
  searchProducts,
} = require("../controllers/product.controller");
const { getProductReviews } = require("../controllers/review.controller");
const {
  productQueryRules,
  productIdRules,
} = require("../validators/product.validator");
const validate = require("../middleware/validate");

const router = Router();

// GET /api/products — list with filtering, sorting, pagination
router.get("/", productQueryRules, validate, listProducts);

// GET /api/products/search — text search (MUST be before /:slug)
router.get("/search", productQueryRules, validate, searchProducts);

// GET /api/products/:slug — single product by slug
router.get("/:slug", getProduct);

// GET /api/products/:id/related — related products
router.get("/:id/related", productIdRules, validate, getRelatedProducts);

// GET /api/products/:productId/reviews — public product reviews
router.get("/:productId/reviews", getProductReviews);

module.exports = router;
