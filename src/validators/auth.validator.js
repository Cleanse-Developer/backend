const { body } = require("express-validator");
const { isValidPhone } = require("../utils/phoneUtils");

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

const loginRules = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Valid email is required"),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
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
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters"),
  body("referralCode")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage("Referral code is too long")
    .matches(/^[A-Za-z0-9-]+$/)
    .withMessage("Invalid referral code format"),
];

const checkAccountRules = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required"),
];

module.exports = { sendOtpRules, verifyOtpRules, loginRules, registerRules, checkAccountRules };
