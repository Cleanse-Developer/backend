const Order = require("../models/Order");
const generateOrderId = require("../utils/generateOrderId");
const { validateCoupon } = require("./coupon.service");
const {
  DISCOUNT_TIERS,
  SHIPPING,
  GIFT_WRAP_COST,
} = require("../utils/constants");

/**
 * Generate a unique order ID in the format "CA-YYYY-XXXX".
 * @returns {Promise<string>}
 */
const createOrderId = async () => {
  return generateOrderId(Order);
};

/**
 * Calculate complete pricing breakdown for an order.
 * @param {object} cart - Cart document with populated items (items[].product must have .price)
 * @param {string|null} couponCode - Coupon code to apply (optional)
 * @param {string} userId - User ID for coupon validation
 * @param {boolean} giftWrap - Whether gift wrap is requested
 * @returns {Promise<object>} Pricing breakdown
 */
const calculatePricing = async (cart, couponCode, userId, giftWrap = false) => {
  // 1. Calculate subtotal
  const subtotal = cart.items.reduce((sum, item) => {
    return sum + item.product.price * item.quantity;
  }, 0);

  // 2. Find applicable tier discount (highest qualifying tier)
  let tierDiscount = 0;
  let tierPercent = 0;
  let tierLabel = null;

  for (const tier of DISCOUNT_TIERS) {
    if (subtotal >= tier.threshold) {
      tierPercent = tier.percent;
      tierLabel = tier.label;
      tierDiscount = Math.round((subtotal * tier.percent) / 100);
      break; // DISCOUNT_TIERS is sorted descending by threshold
    }
  }

  // 3. Validate and calculate coupon discount
  let couponDiscount = 0;
  let appliedCouponCode = null;

  if (couponCode) {
    const couponResult = await validateCoupon(couponCode, userId, subtotal);
    if (couponResult.valid) {
      couponDiscount = couponResult.discount;
      appliedCouponCode = couponCode.toUpperCase();
    }
  }

  // 4. Shipping cost
  const shippingCost = subtotal >= SHIPPING.FREE_THRESHOLD ? 0 : SHIPPING.STANDARD_RATE;

  // 5. Gift wrap cost
  const giftWrapCost = giftWrap ? GIFT_WRAP_COST : 0;

  // 6. Total (never below 0)
  const total = Math.max(
    0,
    subtotal - tierDiscount - couponDiscount + shippingCost + giftWrapCost
  );

  // 7. Loyalty points
  const loyaltyPoints = Math.floor(total / 10);

  return {
    subtotal,
    tierDiscount,
    tierPercent,
    tierLabel,
    couponDiscount,
    couponCode: appliedCouponCode,
    shippingCost,
    giftWrapCost,
    total,
    loyaltyPoints,
  };
};

module.exports = { createOrderId, calculatePricing };
