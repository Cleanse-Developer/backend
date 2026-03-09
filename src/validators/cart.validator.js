const { body } = require("express-validator");

const addItemRules = [
  body("productId")
    .notEmpty()
    .withMessage("Product ID is required")
    .isMongoId()
    .withMessage("Invalid product ID"),
  body("quantity")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Quantity must be a positive integer")
    .toInt(),
  body("selectedSize")
    .optional()
    .isString()
    .withMessage("Selected size must be a string")
    .trim(),
];

const updateItemRules = [
  body("quantity")
    .notEmpty()
    .withMessage("Quantity is required")
    .isInt({ min: 0 })
    .withMessage("Quantity must be a non-negative integer")
    .toInt(),
];

module.exports = { addItemRules, updateItemRules };
