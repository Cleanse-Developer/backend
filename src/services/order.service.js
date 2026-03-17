const Order = require("../models/Order");
const generateOrderId = require("../utils/generateOrderId");

/**
 * Generate a unique order ID in the format "CA-YYYY-XXXX".
 * @returns {Promise<string>}
 */
const createOrderId = async () => {
  return generateOrderId(Order);
};

module.exports = { createOrderId };
