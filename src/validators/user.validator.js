const { body } = require("express-validator");
const { isValidPhone } = require("../utils/phoneUtils");

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
    .custom((value) => {
      if (value && !isValidPhone(value)) {
        throw new Error("Valid 10-digit Indian mobile number is required");
      }
      return true;
    }),
  body("countryCode")
    .optional()
    .trim()
    .matches(/^\+\d{1,3}$/)
    .withMessage("Country code must be in format +XX or +XXX (e.g. +91)"),
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
