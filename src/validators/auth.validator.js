const { body } = require("express-validator");

const sendOtpRules = [
  body("identifier")
    .trim()
    .notEmpty()
    .withMessage("Email or phone is required"),
];

const verifyOtpRules = [
  body("identifier")
    .trim()
    .notEmpty()
    .withMessage("Email or phone is required"),
  body("otp")
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage("OTP must be 6 digits")
    .isNumeric()
    .withMessage("OTP must be numeric"),
];

const registerRules = [
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ max: 100 })
    .withMessage("Name must be under 100 characters"),
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^\+?[0-9]{10,15}$/)
    .withMessage("Valid phone number is required"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters"),
];

module.exports = { sendOtpRules, verifyOtpRules, registerRules };
