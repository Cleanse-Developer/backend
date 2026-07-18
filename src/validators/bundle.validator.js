const { body, param } = require("express-validator");

const createBundleRules = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Bundle name is required")
    .isLength({ max: 200 })
    .withMessage("Name must be at most 200 characters"),
  body("slug")
    .trim()
    .notEmpty()
    .withMessage("Slug is required")
    .matches(/^[a-z0-9-]+$/)
    .withMessage("Slug must contain only lowercase letters, numbers, and hyphens"),
  body("products")
    .isArray({ min: 2 })
    .withMessage("At least 2 products are required"),
  body("products.*")
    .isMongoId()
    .withMessage("Each product must be a valid ID"),
  body("discountType")
    .isIn(["percentage", "fixed"])
    .withMessage("discountType must be percentage or fixed"),
  body("discountValue")
    .isFloat({ min: 0 })
    .withMessage("discountValue must be a non-negative number"),
  body("minProducts")
    .optional()
    .isInt({ min: 2 })
    .withMessage("minProducts must be at least 2"),
  body("description")
    .optional()
    .isLength({ max: 1000 }),
  body("subtitle")
    .optional()
    .isLength({ max: 300 }),
  body("displayOnProducts")
    .optional()
    .isArray(),
  body("displayOnProducts.*")
    .optional()
    .isMongoId(),
  body("isActive")
    .optional()
    .isBoolean(),
  body("priority")
    .optional()
    .isInt(),
  body("ribbonText")
    .optional()
    .isLength({ max: 40 })
    .withMessage("Ribbon text must be at most 40 characters"),
  body("isFeatured")
    .optional()
    .isBoolean(),
];

const updateBundleRules = [
  param("id").isMongoId().withMessage("Invalid bundle ID"),
  body("name")
    .optional()
    .trim()
    .isLength({ max: 200 }),
  body("slug")
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/),
  body("products")
    .optional()
    .isArray({ min: 2 }),
  body("products.*")
    .optional()
    .isMongoId(),
  body("discountType")
    .optional()
    .isIn(["percentage", "fixed"]),
  body("discountValue")
    .optional()
    .isFloat({ min: 0 }),
  body("minProducts")
    .optional()
    .isInt({ min: 2 }),
  body("ribbonText")
    .optional()
    .isLength({ max: 40 }),
  body("isFeatured")
    .optional()
    .isBoolean(),
];

const bundleIdRules = [
  param("id").isMongoId().withMessage("Invalid bundle ID"),
];

module.exports = { createBundleRules, updateBundleRules, bundleIdRules };
