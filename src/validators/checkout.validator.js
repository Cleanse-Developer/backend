const { body } = require("express-validator");
const { isValidPhone } = require("../utils/phoneUtils");

const initiateCheckoutRules = [
  body("shippingInfo.fullName")
    .notEmpty()
    .withMessage("Full name is required")
    .isString()
    .trim(),
  body("shippingInfo.email")
    .optional()
    .isEmail()
    .withMessage("Invalid email address"),
  body("shippingInfo.phone")
    .notEmpty()
    .withMessage("Phone number is required")
    .custom((value, { req }) => {
      if (!isValidPhone(value, req.body?.shippingInfo?.countryCode)) {
        throw new Error("Please enter a valid phone number");
      }
      return true;
    }),
  body("shippingInfo.countryCode")
    .optional()
    .trim()
    .matches(/^\+\d{1,3}$/)
    .withMessage("Country code must be in format +XX or +XXX (e.g. +91)"),
  body("shippingInfo.address1")
    .notEmpty()
    .withMessage("Address is required")
    .isString()
    .trim(),
  body("shippingInfo.city")
    .notEmpty()
    .withMessage("City is required")
    .isString()
    .trim(),
  body("shippingInfo.state")
    .notEmpty()
    .withMessage("State is required")
    .isString()
    .trim(),
  body("shippingInfo.pincode")
    .notEmpty()
    .withMessage("Pincode is required")
    .isString()
    .trim(),
  body("shippingInfo.country").optional().isString().trim(),
  body("paymentMethod")
    .notEmpty()
    .withMessage("Payment method is required")
    .isIn(["razorpay"])
    .withMessage("Only razorpay is supported for this endpoint"),
  body("idempotencyKey")
    .notEmpty()
    .withMessage("Idempotency key is required")
    .isUUID()
    .withMessage("Idempotency key must be a valid UUID"),
  body("couponCode").optional().isString().trim(),
  body("specialCouponCode").optional().isString().trim(),
  body("giftWrap").optional().isBoolean().withMessage("Gift wrap must be a boolean"),
  body("giftMessage")
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage("Gift message must be 200 characters or less"),
];

const confirmCheckoutRules = [
  body("sessionId")
    .notEmpty()
    .withMessage("Session ID is required")
    .isMongoId()
    .withMessage("Invalid session ID"),
  body("razorpayOrderId")
    .notEmpty()
    .withMessage("Razorpay order ID is required")
    .isString(),
  body("razorpayPaymentId")
    .notEmpty()
    .withMessage("Razorpay payment ID is required")
    .isString(),
  body("razorpaySignature")
    .notEmpty()
    .withMessage("Razorpay signature is required")
    .isString(),
];

module.exports = { initiateCheckoutRules, confirmCheckoutRules };
