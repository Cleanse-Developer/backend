const { body } = require("express-validator");

const submitReviewRules = [
  body("productId")
    .notEmpty()
    .withMessage("Product ID is required")
    .isMongoId()
    .withMessage("Invalid product ID"),
  body("rating")
    .notEmpty()
    .withMessage("Rating is required")
    .isInt({ min: 1, max: 5 })
    .withMessage("Rating must be between 1 and 5"),
  body("title")
    .optional()
    .isString()
    .withMessage("Title must be a string")
    .isLength({ max: 100 })
    .withMessage("Title must be at most 100 characters"),
  body("text")
    .notEmpty()
    .withMessage("Review text is required")
    .isString()
    .withMessage("Review text must be a string")
    .isLength({ max: 2000 })
    .withMessage("Review text must be at most 2000 characters"),
];

module.exports = { submitReviewRules };
