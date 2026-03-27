const Product = require("../models/Product");
const {
  findQualifyingAutoPromotions,
  validateSpecialCouponCode,
  calculatePromotionDiscount,
} = require("./specialCoupon.service");

/**
 * Resolve which promotions to apply given the cart state, applying stacking rules.
 *
 * @param {Array} cartItems - Cart items with populated product
 * @param {string|null} userId - User ID
 * @param {number} cartSubtotal - Original subtotal
 * @param {number} effectiveSubtotal - Subtotal after bundle + tier discounts
 * @param {number} shippingCost - Current shipping cost
 * @param {string|null} specialCouponCode - Special coupon code entered by user
 * @param {string|null} regularCouponCode - Regular coupon code entered by user
 * @returns {Promise<object>}
 */
const resolvePromotions = async (
  cartItems,
  userId,
  cartSubtotal,
  effectiveSubtotal,
  shippingCost,
  specialCouponCode,
  regularCouponCode
) => {
  const result = {
    applicableSpecialPromotions: [],
    specialCouponDiscountTotal: 0,
    regularCouponAllowed: true,
    freeGifts: [],
    shippingAdjustment: null,
    messages: [],
  };

  if (cartItems.length === 0) return result;

  // 1. Find all qualifying automatic promotions
  const autoPromotions = await findQualifyingAutoPromotions(
    cartItems,
    userId,
    cartSubtotal
  );

  // 2. If a special coupon code was provided, validate it
  let codePromotion = null;
  if (specialCouponCode) {
    const validation = await validateSpecialCouponCode(
      specialCouponCode,
      cartItems,
      userId,
      cartSubtotal
    );
    if (validation.valid) {
      codePromotion = validation.promotion;
    } else {
      result.messages.push(validation.message);
    }
  }

  // 3. Combine candidates
  let candidates = [...autoPromotions];
  if (codePromotion) {
    candidates.push(codePromotion);
  }

  if (candidates.length === 0) return result;

  // 4. Apply stacking rules
  const resolved = applyStackingRules(candidates);

  // 5. Calculate discount for each surviving promotion
  let runningEffective = effectiveSubtotal;
  let runningShipping = shippingCost;

  for (const promo of resolved) {
    const discountResult = calculatePromotionDiscount(
      promo,
      cartItems,
      cartSubtotal,
      runningEffective,
      runningShipping
    );

    // Apply max discount per order cap
    let finalDiscount = discountResult.discountAmount;
    if (promo.maxDiscountPerOrder) {
      finalDiscount = Math.min(finalDiscount, promo.maxDiscountPerOrder);
    }

    // Never go below 0
    finalDiscount = Math.min(finalDiscount, runningEffective);

    if (finalDiscount > 0 || discountResult.freeItems.length > 0 || discountResult.shippingAdjustment !== null) {
      result.applicableSpecialPromotions.push({
        specialCouponId: promo._id,
        promotionType: promo.promotionType,
        title: promo.title,
        code: promo.code || null,
        discountAmount: finalDiscount,
        freeItems: discountResult.freeItems,
        affectedItemIds: discountResult.affectedItemIds,
      });

      result.specialCouponDiscountTotal += finalDiscount;
      runningEffective -= finalDiscount;

      // Collect free gifts
      for (const gift of discountResult.freeItems) {
        result.freeGifts.push(gift);
      }

      // Shipping adjustment (take the lowest/best)
      if (discountResult.shippingAdjustment !== null) {
        if (result.shippingAdjustment === null) {
          result.shippingAdjustment = discountResult.shippingAdjustment;
        } else {
          result.shippingAdjustment = Math.min(
            result.shippingAdjustment,
            discountResult.shippingAdjustment
          );
        }
        runningShipping = result.shippingAdjustment;
      }

      result.messages.push(`${promo.title} applied`);
    }
  }

  // 6. Determine if regular coupon is allowed
  // If any applied promotion has excludeWithCoupons=true, block regular coupon
  const anyBlocksRegular = resolved.some(
    (promo) =>
      promo.excludeWithCoupons &&
      result.applicableSpecialPromotions.some(
        (ap) => ap.specialCouponId.toString() === promo._id.toString()
      )
  );

  if (anyBlocksRegular && regularCouponCode) {
    result.regularCouponAllowed = false;
    result.messages.push(
      "Regular coupon cannot be combined with the active promotion"
    );
  }

  // 7. Enrich free gifts with product names for frontend display
  if (result.freeGifts.length > 0) {
    const productIds = result.freeGifts.map((g) => g.productId);
    const products = await Product.find({ _id: { $in: productIds } })
      .select("name price images")
      .lean();
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    result.freeGifts = result.freeGifts.map((gift) => {
      const prod = productMap.get(gift.productId.toString());
      const primaryImage = prod?.images?.find((img) => img.isPrimary);
      return {
        ...gift,
        productName: prod?.name || "Gift",
        productImage: primaryImage?.url || prod?.images?.[0]?.url || "",
        unitPrice: prod?.price || 0,
      };
    });
  }

  return result;
};

/**
 * Apply stacking rules to a list of candidate promotions.
 * Returns the final list of promotions to apply.
 *
 * Rules:
 * 1. Sort by priority descending
 * 2. Group by stackGroup -- within same group, keep only highest priority
 * 3. Filter out mutual exclusions (excludeWithOther)
 * 4. For non-stackable promotions, keep only the best one among non-stackable
 * 5. Code-based: at most one code-based special coupon
 */
function applyStackingRules(candidates) {
  if (candidates.length <= 1) return candidates;

  // Sort by priority descending
  let sorted = [...candidates].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Group by stackGroup -- keep only highest priority per group
  const groupSeen = {};
  sorted = sorted.filter((promo) => {
    if (!promo.stackGroup) return true;
    if (groupSeen[promo.stackGroup]) return false;
    groupSeen[promo.stackGroup] = true;
    return true;
  });

  // Filter out mutual exclusions
  const excludedIds = new Set();
  for (const promo of sorted) {
    if (promo.excludeWithOther && promo.excludeWithOther.length > 0) {
      for (const excludedId of promo.excludeWithOther) {
        // Only exclude lower-priority ones
        const excluded = sorted.find(
          (p) =>
            p._id.toString() === excludedId.toString() &&
            (p.priority || 0) < (promo.priority || 0)
        );
        if (excluded) {
          excludedIds.add(excluded._id.toString());
        }
      }
    }
  }
  sorted = sorted.filter((promo) => !excludedIds.has(promo._id.toString()));

  // Only one code-based special coupon
  let codeFound = false;
  sorted = sorted.filter((promo) => {
    if (promo.applicationMethod === "code") {
      if (codeFound) return false;
      codeFound = true;
    }
    return true;
  });

  // Non-stackable promotions: among all non-stackable ones, keep only highest priority
  const stackable = sorted.filter((p) => p.stackable);
  const nonStackable = sorted.filter((p) => !p.stackable);

  if (nonStackable.length > 1) {
    // Keep only the highest priority non-stackable
    return [...stackable, nonStackable[0]];
  }

  return sorted;
}

module.exports = { resolvePromotions };
