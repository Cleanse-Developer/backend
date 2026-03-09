const { body } = require("express-validator");

const placeOrderRules = [
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
    .isString()
    .trim(),
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
  body("paymentMethod")
    .notEmpty()
    .withMessage("Payment method is required")
    .isIn(["razorpay", "cod", "upi"])
    .withMessage("Invalid payment method"),
  body("couponCode").optional().isString().trim(),
  body("giftWrap").optional().isBoolean().withMessage("Gift wrap must be a boolean"),
  body("giftMessage")
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage("Gift message must be 200 characters or less"),
];

const returnRules = [
  body("reason")
    .notEmpty()
    .withMessage("Return reason is required")
    .isString()
    .trim(),
];

module.exports = { placeOrderRules, returnRules };
