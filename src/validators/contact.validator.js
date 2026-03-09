const { body } = require("express-validator");

const contactRules = [
  body("name")
    .notEmpty()
    .withMessage("Name is required")
    .trim(),
  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),
  body("phone")
    .optional()
    .trim(),
  body("subject")
    .optional()
    .isIn(["order", "product", "return", "wholesale", "other"])
    .withMessage("Subject must be order, product, return, wholesale, or other"),
  body("message")
    .notEmpty()
    .withMessage("Message is required")
    .isLength({ max: 5000 })
    .withMessage("Message must be at most 5000 characters"),
];

module.exports = { contactRules };
