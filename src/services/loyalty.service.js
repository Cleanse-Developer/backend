const User = require("../models/User");
const LoyaltyTransaction = require("../models/LoyaltyTransaction");

/**
 * Award loyalty points to a user and record the transaction.
 * @param {string} userId - User ID
 * @param {number} points - Points to award
 * @param {string} orderId - Associated order ID (ObjectId)
 * @param {string} description - Description of the transaction
 * @returns {Promise<object>} Created LoyaltyTransaction
 */
const awardPoints = async (userId, points, orderId, description) => {
  if (points <= 0) return null;

  await User.findByIdAndUpdate(userId, {
    $inc: { loyaltyPoints: points },
  });

  const transaction = await LoyaltyTransaction.create({
    user: userId,
    type: "earned",
    points,
    order: orderId,
    description: description || `Earned ${points} points from order`,
  });

  return transaction;
};

module.exports = { awardPoints };
