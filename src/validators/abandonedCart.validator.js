const { query } = require("express-validator");

// Query rules for the public abandoned-carts list. All optional with defaults
// applied in the controller.
const listAbandonedCartsRules = [
  query("staleMinutes")
    .optional()
    .isInt({ min: 1, max: 60 * 24 * 90 })
    .withMessage("staleMinutes must be an integer between 1 and 129600")
    .toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100")
    .toInt(),
  query("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("offset must be a non-negative integer")
    .toInt(),
  query("userId")
    .optional()
    .isMongoId()
    .withMessage("Invalid userId"),
];

module.exports = { listAbandonedCartsRules };
