const Coupon = require("../models/Coupon");
const Order = require("../models/Order");

/**
 * Validate a coupon code and calculate the discount amount.
 * @param {string} code - Coupon code
 * @param {string} userId - ID of the current user
 * @param {number} cartSubtotal - Cart subtotal before any discounts (used for min order check)
 * @param {number} [effectiveSubtotal] - Amount to calculate discount on (after other discounts). Defaults to cartSubtotal.
 * @returns {{ valid: boolean, discount: number, discountType: string, description: string, message: string }}
 */
const validateCoupon = async (code, userId, cartSubtotal, effectiveSubtotal) => {
  // If effectiveSubtotal not provided, use cartSubtotal (backwards compatible)
  const discountBase = effectiveSubtotal != null ? effectiveSubtotal : cartSubtotal;
  const coupon = await Coupon.findOne({ code: code.toUpperCase() });

  if (!coupon) {
    return { valid: false, discount: 0, message: "Invalid coupon code" };
  }

  if (!coupon.isActive) {
    return { valid: false, discount: 0, message: "This coupon is no longer active" };
  }

  const now = new Date();
  if (now < coupon.validFrom) {
    return { valid: false, discount: 0, message: "This coupon is not yet valid" };
  }

  if (now > coupon.validTill) {
    return { valid: false, discount: 0, message: "This coupon has expired" };
  }

  // Check overall usage limit
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, discount: 0, message: "This coupon has reached its usage limit" };
  }

  // Check per-user limit (skip for guest users)
  if (userId) {
    const userUsageCount = coupon.usedBy.filter(
      (entry) => entry.user.toString() === userId.toString()
    ).length;

    if (userUsageCount >= coupon.perUserLimit) {
      return { valid: false, discount: 0, message: "You have already used this coupon" };
    }
  }

  // Check minimum order value
  if (cartSubtotal < coupon.minOrderValue) {
    return {
      valid: false,
      discount: 0,
      message: `Minimum order value of ₹${coupon.minOrderValue} required`,
    };
  }

  // Check first-order-only restriction (skip for guest — they'll be validated at order time)
  if (coupon.isFirstOrderOnly && userId) {
    const orderCount = await Order.countDocuments({ user: userId });
    if (orderCount > 0) {
      return { valid: false, discount: 0, message: "This coupon is valid for first orders only" };
    }
  }

  // Calculate discount (on effective subtotal, which accounts for other discounts)
  let discount = 0;

  if (coupon.discountType === "percentage") {
    discount = Math.round((discountBase * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }
  } else if (coupon.discountType === "fixed") {
    discount = Math.min(coupon.discountValue, discountBase);
  } else if (coupon.discountType === "free_shipping") {
    discount = 0; // handled separately in pricing logic
  }

  return {
    valid: true,
    discount,
    discountType: coupon.discountType,
    description: coupon.description,
    message: "Coupon applied successfully",
  };
};

module.exports = { validateCoupon };
