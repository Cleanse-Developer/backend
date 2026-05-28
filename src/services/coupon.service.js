const Coupon = require("../models/Coupon");
const Order = require("../models/Order");

/**
 * Validate a coupon code and calculate the discount amount.
 *
 * @param {string} code - Coupon code
 * @param {string} userId - ID of the current user (null for guests)
 * @param {number} cartSubtotal - Cart subtotal before any discounts (used for min order check)
 * @param {number} [effectiveSubtotal] - Amount to calculate discount on (after other discounts). Defaults to cartSubtotal.
 * @param {Array} [cartItems] - Populated cart items (items[].product must have _id, price, category).
 *                               Required for applicableProducts/applicableCategories filtering.
 * @returns {{ valid: boolean, discount: number, discountType: string, description: string, message: string }}
 */
const validateCoupon = async (code, userId, cartSubtotal, effectiveSubtotal, cartItems) => {
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

  // Check first-order-only restriction (skip for guest -- validated at order time)
  if (coupon.isFirstOrderOnly && userId) {
    const orderCount = await Order.countDocuments({ user: userId });
    if (orderCount > 0) {
      return { valid: false, discount: 0, message: "This coupon is valid for first orders only" };
    }
  }

  // Determine the discount base: if coupon is restricted to specific products
  // or categories, only count those items toward the discount.
  let applicableDiscountBase = discountBase;

  const hasProductRestriction =
    coupon.applicableProducts && coupon.applicableProducts.length > 0;
  const hasCategoryRestriction =
    coupon.applicableCategories && coupon.applicableCategories.length > 0;

  if ((hasProductRestriction || hasCategoryRestriction) && cartItems && cartItems.length > 0) {
    const applicableProductIds = hasProductRestriction
      ? coupon.applicableProducts.map((id) => id.toString())
      : null;
    const applicableCategoryIds = hasCategoryRestriction
      ? coupon.applicableCategories.map((id) => id.toString())
      : null;

    // Filter cart items to those matching the coupon's restrictions
    const matchingItems = cartItems.filter((item) => {
      const product = item.product;
      const productId = (product._id || product).toString();
      const categoryId = product.category?.toString();

      // If both restrictions exist, item must match at least one
      if (applicableProductIds && applicableCategoryIds) {
        return (
          applicableProductIds.includes(productId) ||
          applicableCategoryIds.includes(categoryId)
        );
      }

      if (applicableProductIds) {
        return applicableProductIds.includes(productId);
      }

      if (applicableCategoryIds) {
        return applicableCategoryIds.includes(categoryId);
      }

      return true;
    });

    if (matchingItems.length === 0) {
      return {
        valid: false,
        discount: 0,
        message: "This coupon does not apply to any items in your cart",
      };
    }

    // Compute the subtotal of only the matching items
    const matchingSubtotal = matchingItems.reduce((sum, item) => {
      const price = item.product.price ?? item.product;
      return sum + (typeof price === "number" ? price : 0) * item.quantity;
    }, 0);

    // Scale the effective discount base proportionally:
    // If the effective subtotal is reduced by other discounts (bundles, tier, etc.),
    // the applicable portion should be reduced by the same ratio.
    const ratio = cartSubtotal > 0 ? matchingSubtotal / cartSubtotal : 0;
    applicableDiscountBase = Math.round(discountBase * ratio);
  }

  // Calculate discount on the applicable discount base
  let discount = 0;

  if (coupon.discountType === "percentage") {
    discount = Math.round((applicableDiscountBase * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }
  } else if (coupon.discountType === "fixed") {
    discount = Math.min(coupon.discountValue, applicableDiscountBase);
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
