const { body } = require("express-validator");

const updateProfileRules = [
  body("fullName")
    .optional()
    .isString()
    .withMessage("Full name must be a string")
    .trim(),
  body("email")
    .optional()
    .isEmail()
    .withMessage("Must be a valid email address")
    .normalizeEmail(),
  body("phone")
    .optional()
    .isString()
    .withMessage("Phone must be a string")
    .trim(),
  body("dateOfBirth")
    .optional()
    .isISO8601()
    .withMessage("Date of birth must be a valid date")
    .toDate(),
];

const updatePreferencesRules = [
  body("orderUpdates")
    .optional()
    .isBoolean()
    .withMessage("orderUpdates must be a boolean"),
  body("promotions")
    .optional()
    .isBoolean()
    .withMessage("promotions must be a boolean"),
  body("newsletter")
    .optional()
    .isBoolean()
    .withMessage("newsletter must be a boolean"),
];

module.exports = { updateProfileRules, updatePreferencesRules };
