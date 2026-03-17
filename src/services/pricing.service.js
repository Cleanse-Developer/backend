const Bundle = require("../models/Bundle");
const { validateCoupon } = require("./coupon.service");
const {
  DISCOUNT_TIERS,
  SHIPPING,
  GIFT_WRAP_COST,
} = require("../utils/constants");

/**
 * Detect which cart items qualify for bundle discounts.
 * A bundle qualifies when the cart contains >= bundle.minProducts products from that bundle.
 * Each cart item can only belong to one bundle (the one giving the highest discount).
 *
 * @param {Array} cartItems - Cart items with populated product (needs product._id, product.price)
 * @returns {Promise<object>} { bundleDiscounts: [...], bundleDiscountTotal: number }
 */
const calculateBundleDiscounts = async (cartItems) => {
  // Get all product IDs in the cart
  const cartProductIds = cartItems.map((item) => item.product._id.toString());

  // Find active bundles that contain any of the cart products
  const bundles = await Bundle.find({
    isActive: true,
    products: { $in: cartProductIds },
  }).lean();

  if (!bundles.length) {
    return { bundleDiscounts: [], bundleDiscountTotal: 0 };
  }

  // For each bundle, check if enough products from it are in the cart
  const qualifyingBundles = [];

  for (const bundle of bundles) {
    const bundleProductIds = bundle.products.map((p) => p.toString());

    // Find cart items that belong to this bundle
    const matchingItems = cartItems.filter((item) =>
      bundleProductIds.includes(item.product._id.toString())
    );

    if (matchingItems.length >= bundle.minProducts) {
      // Calculate the subtotal of matching items
      const bundleSubtotal = matchingItems.reduce(
        (sum, item) => sum + item.product.price * item.quantity,
        0
      );

      // Calculate discount amount
      let discountAmount = 0;
      if (bundle.discountType === "percentage") {
        discountAmount = Math.round(
          (bundleSubtotal * bundle.discountValue) / 100
        );
      } else {
        // fixed
        discountAmount = bundle.discountValue;
      }

      // Cap discount at the bundle subtotal
      discountAmount = Math.min(discountAmount, bundleSubtotal);

      qualifyingBundles.push({
        bundleId: bundle._id,
        bundleName: bundle.name,
        bundleSlug: bundle.slug,
        discountType: bundle.discountType,
        discountValue: bundle.discountValue,
        matchingProductIds: matchingItems.map((i) => i.product._id.toString()),
        bundleSubtotal,
        discountAmount,
      });
    }
  }

  // Resolve conflicts: if a product appears in multiple qualifying bundles,
  // assign it to the bundle that gives the highest discount.
  // Simple greedy: sort bundles by discount amount descending, assign products greedily.
  qualifyingBundles.sort((a, b) => b.discountAmount - a.discountAmount);

  const assignedProducts = new Set();
  const finalBundleDiscounts = [];

  for (const bundle of qualifyingBundles) {
    // Filter out products already assigned to a higher-discount bundle
    const availableProductIds = bundle.matchingProductIds.filter(
      (pid) => !assignedProducts.has(pid)
    );

    // Re-check if we still meet minProducts after removing assigned ones
    // We need to look at unique products, not total items
    const availableItems = cartItems.filter((item) =>
      availableProductIds.includes(item.product._id.toString())
    );

    // Find the original bundle to get minProducts
    const originalBundle = bundles.find(
      (b) => b._id.toString() === bundle.bundleId.toString()
    );
    if (availableItems.length < originalBundle.minProducts) {
      continue; // Not enough unassigned products
    }

    // Recalculate with available items only
    const bundleSubtotal = availableItems.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );

    let discountAmount = 0;
    if (bundle.discountType === "percentage") {
      discountAmount = Math.round(
        (bundleSubtotal * bundle.discountValue) / 100
      );
    } else {
      discountAmount = bundle.discountValue;
    }
    discountAmount = Math.min(discountAmount, bundleSubtotal);

    // Mark products as assigned
    for (const pid of availableProductIds) {
      assignedProducts.add(pid);
    }

    finalBundleDiscounts.push({
      bundleId: bundle.bundleId,
      bundleName: bundle.bundleName,
      bundleSlug: bundle.bundleSlug,
      discountType: bundle.discountType,
      discountValue: bundle.discountValue,
      productIds: availableProductIds,
      bundleSubtotal,
      discountAmount,
    });
  }

  const bundleDiscountTotal = finalBundleDiscounts.reduce(
    (sum, b) => sum + b.discountAmount,
    0
  );

  return { bundleDiscounts: finalBundleDiscounts, bundleDiscountTotal };
};

/**
 * Calculate complete pricing breakdown for an order.
 *
 * Discount application order:
 * 1. Subtotal = sum of all item prices
 * 2. Bundle discounts = per-bundle discounts on qualifying product groups
 * 3. Tier discount = percentage off the FULL subtotal (based on cart value tiers)
 * 4. Coupon discount = additional code-based discount
 * 5. Shipping = standard rate or free above threshold
 * 6. Gift wrap = optional flat fee
 * 7. Total = subtotal - bundleDiscount - tierDiscount - couponDiscount + shipping + giftWrap
 *
 * Note: tier discount threshold is checked against the original subtotal (not after bundle discount).
 * This keeps the progress bar experience consistent — user sees "spend ₹X more for Y% off".
 *
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

  // 2. Calculate bundle discounts
  const { bundleDiscounts, bundleDiscountTotal } =
    await calculateBundleDiscounts(cart.items);

  // 3. Find applicable tier discount (highest qualifying tier)
  // Tier is based on original subtotal
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

  // 4. Validate and calculate coupon discount
  // Coupon applies to the effective amount (subtotal - bundleDiscount - tierDiscount)
  let couponDiscount = 0;
  let appliedCouponCode = null;
  let couponDescription = null;
  let couponDiscountType = null;

  if (couponCode) {
    const effectiveSubtotal = Math.max(
      0,
      subtotal - bundleDiscountTotal - tierDiscount
    );
    const couponResult = await validateCoupon(
      couponCode,
      userId,
      subtotal, // min order check against original subtotal
      effectiveSubtotal // actual amount for discount calculation
    );
    if (couponResult.valid) {
      couponDiscount = couponResult.discount;
      appliedCouponCode = couponCode.toUpperCase();
      couponDescription = couponResult.description;
      couponDiscountType = couponResult.discountType;
    }
  }

  // 5. Shipping cost (based on original subtotal for threshold check)
  const shippingCost =
    subtotal >= SHIPPING.FREE_THRESHOLD ? 0 : SHIPPING.STANDARD_RATE;

  // Handle free_shipping coupon type
  let effectiveShippingCost = shippingCost;
  if (couponDiscountType === "free_shipping") {
    effectiveShippingCost = 0;
  }

  // 6. Gift wrap cost
  const giftWrapCost = giftWrap ? GIFT_WRAP_COST : 0;

  // 7. Total (never below 0)
  const total = Math.max(
    0,
    subtotal -
      bundleDiscountTotal -
      tierDiscount -
      couponDiscount +
      effectiveShippingCost +
      giftWrapCost
  );

  // 8. Loyalty points (1 point per ₹10 spent)
  const loyaltyPoints = Math.floor(total / 10);

  // 9. Tier progress info for the UI progress bar
  const tierProgress = calculateTierProgress(subtotal);

  return {
    subtotal,
    bundleDiscounts,
    bundleDiscountTotal,
    tierDiscount,
    tierPercent,
    tierLabel,
    couponDiscount,
    couponCode: appliedCouponCode,
    couponDescription,
    shippingCost: effectiveShippingCost,
    giftWrapCost,
    total,
    loyaltyPoints,
    tierProgress,
  };
};

/**
 * Calculate tier progress for UI display (progress bar in cart).
 * Shows current tier, next tier, and how much more to spend.
 */
const calculateTierProgress = (subtotal) => {
  const tiers = [...DISCOUNT_TIERS].reverse(); // ascending order for progress

  let currentTier = null;
  let nextTier = null;

  for (let i = 0; i < tiers.length; i++) {
    if (subtotal >= tiers[i].threshold) {
      currentTier = tiers[i];
      nextTier = tiers[i + 1] || null;
    } else {
      if (!nextTier) nextTier = tiers[i];
      break;
    }
  }

  const amountToNextTier = nextTier
    ? Math.max(0, nextTier.threshold - subtotal)
    : 0;

  return {
    currentTier: currentTier
      ? {
          threshold: currentTier.threshold,
          percent: currentTier.percent,
          label: currentTier.label,
        }
      : null,
    nextTier: nextTier
      ? {
          threshold: nextTier.threshold,
          percent: nextTier.percent,
          label: nextTier.label,
        }
      : null,
    amountToNextTier,
    tiers: tiers.map((t) => ({
      threshold: t.threshold,
      percent: t.percent,
      label: t.label,
      reached: subtotal >= t.threshold,
    })),
    // Also include free shipping threshold
    freeShipping: {
      threshold: SHIPPING.FREE_THRESHOLD,
      reached: subtotal >= SHIPPING.FREE_THRESHOLD,
      amountNeeded: Math.max(0, SHIPPING.FREE_THRESHOLD - subtotal),
    },
  };
};

module.exports = { calculatePricing, calculateBundleDiscounts, calculateTierProgress };
