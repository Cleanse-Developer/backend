const { body } = require("express-validator");
const { isValidPhone } = require("../utils/phoneUtils");

const addressRules = [
  body("label")
    .notEmpty()
    .withMessage("Label is required")
    .isString()
    .trim(),
  body("fullName")
    .notEmpty()
    .withMessage("Full name is required")
    .isString()
    .trim(),
  body("phone")
    .notEmpty()
    .withMessage("Phone is required")
    .custom((value) => {
      if (!isValidPhone(value)) {
        throw new Error("Valid 10-digit Indian mobile number is required");
      }
      return true;
    }),
  body("countryCode")
    .optional()
    .trim()
    .matches(/^\+\d{1,3}$/)
    .withMessage("Country code must be in format +XX or +XXX (e.g. +91)"),
  body("address1")
    .notEmpty()
    .withMessage("Address line 1 is required")
    .isString()
    .trim(),
  body("address2")
    .optional()
    .isString()
    .trim(),
  body("city")
    .notEmpty()
    .withMessage("City is required")
    .isString()
    .trim(),
  body("state")
    .notEmpty()
    .withMessage("State is required")
    .isString()
    .trim(),
  body("pincode")
    .notEmpty()
    .withMessage("Pincode is required")
    .isString()
    .trim(),
  body("country")
    .optional()
    .isString()
    .trim(),
  body("isDefault")
    .optional()
    .isBoolean()
    .withMessage("isDefault must be a boolean"),
];

// For PATCH: all fields optional
const addressPatchRules = [
  body("label").optional().isString().trim(),
  body("fullName").optional().isString().trim(),
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
  body("address1").optional().isString().trim(),
  body("address2").optional().isString().trim(),
  body("city").optional().isString().trim(),
  body("state").optional().isString().trim(),
  body("pincode").optional().isString().trim(),
  body("country").optional().isString().trim(),
  body("isDefault")
    .optional()
    .isBoolean()
    .withMessage("isDefault must be a boolean"),
];

module.exports = { addressRules, addressPatchRules };
