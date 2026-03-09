const crypto = require("crypto");
const getRazorpay = require("../config/razorpay");

/**
 * Create a Razorpay order.
 * @param {number} amount - Amount in paise (INR smallest unit)
 * @param {string} currency - Currency code (default "INR")
 * @param {string} receipt - Receipt identifier
 * @returns {Promise<object>} Razorpay order object
 */
const createOrder = async (amount, currency = "INR", receipt) => {
  const razorpay = getRazorpay();
  const order = await razorpay.orders.create({
    amount,
    currency,
    receipt,
  });
  return order;
};

/**
 * Verify Razorpay payment signature using HMAC-SHA256.
 * @param {string} orderId - Razorpay order ID
 * @param {string} paymentId - Razorpay payment ID
 * @param {string} signature - Razorpay signature
 * @returns {boolean} Whether the signature is valid
 */
const verifyPayment = (orderId, paymentId, signature) => {
  const body = orderId + "|" + paymentId;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  return expectedSignature === signature;
};

/**
 * Issue a refund for a Razorpay payment.
 * @param {string} paymentId - Razorpay payment ID
 * @param {number} amount - Refund amount in paise (optional, full refund if omitted)
 * @returns {Promise<object>} Razorpay refund object
 */
const issueRefund = async (paymentId, amount) => {
  const razorpay = getRazorpay();
  const options = {};
  if (amount) {
    options.amount = amount;
  }
  const refund = await razorpay.payments.refund(paymentId, options);
  return refund;
};

module.exports = { createOrder, verifyPayment, issueRefund };
