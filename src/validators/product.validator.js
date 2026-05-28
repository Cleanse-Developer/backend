const { query, param } = require("express-validator");

const productQueryRules = [
  query("tag")
    .optional()
    .isIn(["Face Care", "Hair Care", "Body Care"])
    .withMessage("Tag must be Face Care, Hair Care, or Body Care"),
  query("sort")
    .optional()
    .isIn(["price-low", "price-high", "name-az", "name-za", "featured", "newest"])
    .withMessage("Invalid sort option"),
  query("priceRange")
    .optional()
    .isIn(["under-500", "500-1000", "above-1000"])
    .withMessage("Invalid price range"),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer")
    .toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
  query("q")
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Search query must be between 1 and 200 characters"),
];

const productIdRules = [
  param("id")
    .isMongoId()
    .withMessage("Invalid product ID"),
];

const productIdParamRules = [
  param("productId")
    .isMongoId()
    .withMessage("Invalid product ID"),
];

module.exports = { productQueryRules, productIdRules, productIdParamRules };
