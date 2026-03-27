const SpecialCoupon = require("../models/SpecialCoupon");
const Order = require("../models/Order");

/**
 * Find all automatic promotions that currently qualify for the given cart.
 * @param {Array} cartItems - Cart items with populated product ({ product: { _id, price, tag }, quantity })
 * @param {string|null} userId - User ID (null for guests)
 * @param {number} cartSubtotal - Original cart subtotal
 * @returns {Promise<Array>} Qualifying SpecialCoupon documents (lean)
 */
const findQualifyingAutoPromotions = async (cartItems, userId, cartSubtotal) => {
  const now = new Date();
  const promotions = await SpecialCoupon.find({
    isActive: true,
    applicationMethod: "automatic",
    validFrom: { $lte: now },
    validTill: { $gte: now },
  })
    .sort({ priority: -1 })
    .lean();

  const qualifying = [];

  for (const promo of promotions) {
    if (!passesGeneralChecks(promo, userId, cartSubtotal)) continue;
    if (!passesBuyCondition(promo, cartItems, cartSubtotal)) continue;
    qualifying.push(promo);
  }

  return qualifying;
};

/**
 * Validate a special coupon code and check if it qualifies.
 * @param {string} code
 * @param {Array} cartItems
 * @param {string|null} userId
 * @param {number} cartSubtotal
 * @returns {Promise<{ valid: boolean, promotion?: object, message: string }>}
 */
const validateSpecialCouponCode = async (code, cartItems, userId, cartSubtotal) => {
  const promo = await SpecialCoupon.findOne({
    code: code.toUpperCase(),
    applicationMethod: "code",
  }).lean();

  if (!promo) {
    return { valid: false, message: "Invalid promotion code" };
  }

  if (!promo.isActive) {
    return { valid: false, message: "This promotion is no longer active" };
  }

  const now = new Date();
  if (now < new Date(promo.validFrom)) {
    return { valid: false, message: "This promotion is not yet valid" };
  }
  if (now > new Date(promo.validTill)) {
    return { valid: false, message: "This promotion has expired" };
  }

  if (!passesGeneralChecks(promo, userId, cartSubtotal)) {
    return { valid: false, message: "You are not eligible for this promotion" };
  }

  if (!passesBuyCondition(promo, cartItems, cartSubtotal)) {
    return { valid: false, message: "Your cart does not meet the promotion requirements" };
  }

  return { valid: true, promotion: promo, message: "Promotion applied" };
};

/**
 * Calculate the discount for a single special promotion.
 * @param {object} promo - SpecialCoupon document (lean)
 * @param {Array} cartItems - Cart items with populated product
 * @param {number} cartSubtotal
 * @param {number} effectiveSubtotal - After other discounts
 * @param {number} shippingCost - Current shipping cost
 * @returns {{ discountAmount: number, freeItems: Array, shippingAdjustment: number|null, affectedItemIds: Array }}
 */
const calculatePromotionDiscount = (promo, cartItems, cartSubtotal, effectiveSubtotal, shippingCost) => {
  const result = {
    discountAmount: 0,
    freeItems: [],
    shippingAdjustment: null,
    affectedItemIds: [],
  };

  switch (promo.promotionType) {
    case "bxgy":
      return calculateBXGY(promo, cartItems, effectiveSubtotal);
    case "volume_discount":
      return calculateVolumeDiscount(promo, cartItems);
    case "spend_threshold":
      return calculateSpendThreshold(promo, cartItems, cartSubtotal, effectiveSubtotal);
    case "fixed_price_bundle":
      return calculateFixedPriceBundle(promo, cartItems);
    case "free_gift":
      return calculateFreeGift(promo, cartItems, cartSubtotal);
    case "tiered_shipping":
      return calculateTieredShipping(promo, cartSubtotal, shippingCost);
    default:
      return result;
  }
};

// --- General Eligibility Checks ---

function passesGeneralChecks(promo, userId, cartSubtotal) {
  // Usage limit
  if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
    return false;
  }

  // Per-user limit
  if (userId && promo.usedBy && promo.usedBy.length > 0) {
    const userIdStr = userId.toString();
    const userUsageCount = promo.usedBy.filter(
      (entry) => entry.user && entry.user.toString() === userIdStr
    ).length;
    if (userUsageCount >= promo.perUserLimit) {
      return false;
    }
  }

  // Min order value
  if (promo.minOrderValue && cartSubtotal < promo.minOrderValue) {
    return false;
  }

  // Max order value
  if (promo.maxOrderValue && cartSubtotal > promo.maxOrderValue) {
    return false;
  }

  return true;
}

// --- Buy Condition Checks ---

function passesBuyCondition(promo, cartItems, cartSubtotal) {
  const bc = promo.buyCondition;
  if (!bc || !bc.type) return true; // No condition = always passes

  switch (bc.type) {
    case "product": {
      if (!bc.productIds || bc.productIds.length === 0) return true;
      const targetIds = bc.productIds.map((id) => id.toString());
      const matchingItems = cartItems.filter((item) =>
        item.product?._id && targetIds.includes(item.product._id.toString())
      );
      const totalQty = matchingItems.reduce((sum, i) => sum + i.quantity, 0);
      if (bc.minQuantity && totalQty < bc.minQuantity) return false;
      return matchingItems.length > 0;
    }
    case "category": {
      if (!bc.categoryIds || bc.categoryIds.length === 0) return true;
      const targetCats = bc.categoryIds.map((id) => id.toString());
      const matchingItems = cartItems.filter((item) => {
        const productCat = item.product.category?.toString() || item.product.tag;
        return targetCats.includes(productCat);
      });
      const totalQty = matchingItems.reduce((sum, i) => sum + i.quantity, 0);
      if (bc.minQuantity && totalQty < bc.minQuantity) return false;
      return matchingItems.length > 0;
    }
    case "any": {
      if (bc.minQuantity) {
        const totalQty = cartItems.reduce((sum, i) => sum + i.quantity, 0);
        if (totalQty < bc.minQuantity) return false;
      }
      if (bc.minAmount && cartSubtotal < bc.minAmount) return false;
      return true;
    }
    default:
      return true;
  }
}

// --- Discount Calculation Functions ---

function calculateBXGY(promo, cartItems, effectiveSubtotal) {
  const result = { discountAmount: 0, freeItems: [], shippingAdjustment: null, affectedItemIds: [] };
  const reward = promo.getReward;
  if (!reward || !reward.type) return result;

  const buyQty = promo.buyCondition?.minQuantity || 1;
  const getQty = reward.quantity || 1;

  // Find items that match the "get" condition
  let getItems = [];

  switch (reward.rewardScope) {
    case "same_as_buy": {
      // Get items from the same pool as buy condition
      getItems = getMatchingItems(promo.buyCondition, cartItems);
      break;
    }
    case "specific_products": {
      if (reward.productIds && reward.productIds.length > 0) {
        const targetIds = reward.productIds.map((id) => id.toString());
        getItems = cartItems.filter((item) =>
          targetIds.includes(item.product._id.toString())
        );
      }
      break;
    }
    case "cheapest_in_cart": {
      getItems = [...cartItems].sort((a, b) => a.product.price - b.product.price);
      break;
    }
    case "most_expensive_in_cart": {
      getItems = [...cartItems].sort((a, b) => b.product.price - a.product.price);
      break;
    }
    default:
      getItems = getMatchingItems(promo.buyCondition, cartItems);
  }

  if (getItems.length === 0) return result;

  // Calculate how many "get" items to discount
  // For each complete set of buyQty bought, discount getQty items
  const buyItems = getMatchingItems(promo.buyCondition, cartItems);
  const totalBuyQty = buyItems.reduce((sum, i) => sum + i.quantity, 0);
  const sets = Math.floor(totalBuyQty / buyQty);
  const itemsToDiscount = Math.min(sets * getQty, getItems.reduce((s, i) => s + i.quantity, 0));

  if (itemsToDiscount <= 0) return result;

  // Apply discount to the cheapest items first (best for customer)
  let remaining = itemsToDiscount;
  const sortedGetItems = [...getItems].sort((a, b) => a.product.price - b.product.price);

  for (const item of sortedGetItems) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, item.quantity);
    remaining -= qty;

    let discountPerItem = 0;
    switch (reward.type) {
      case "free":
        discountPerItem = item.product.price;
        break;
      case "percentage_off":
        discountPerItem = Math.round((item.product.price * (reward.discountValue || 0)) / 100);
        break;
      case "fixed_off":
        discountPerItem = Math.min(reward.discountValue || 0, item.product.price);
        break;
      default:
        discountPerItem = item.product.price;
    }

    result.discountAmount += discountPerItem * qty;
    result.affectedItemIds.push(item.product._id.toString());
  }

  // Cap at max discount
  if (reward.maxDiscountAmount) {
    result.discountAmount = Math.min(result.discountAmount, reward.maxDiscountAmount);
  }

  // Never exceed effective subtotal
  result.discountAmount = Math.min(result.discountAmount, effectiveSubtotal);

  return result;
}

function calculateVolumeDiscount(promo, cartItems) {
  const result = { discountAmount: 0, freeItems: [], shippingAdjustment: null, affectedItemIds: [] };
  if (!promo.volumeTiers || promo.volumeTiers.length === 0) return result;

  const matchingItems = getMatchingItems(promo.buyCondition, cartItems);
  if (matchingItems.length === 0) return result;

  const totalQty = matchingItems.reduce((sum, i) => sum + i.quantity, 0);

  // Find highest qualifying tier
  const sortedTiers = [...promo.volumeTiers].sort((a, b) => b.minQuantity - a.minQuantity);
  const qualifyingTier = sortedTiers.find((t) => totalQty >= t.minQuantity);

  if (!qualifyingTier) return result;

  // Calculate discount across matching items
  for (const item of matchingItems) {
    let discountPerItem = 0;
    if (qualifyingTier.discountType === "percentage") {
      discountPerItem = Math.round((item.product.price * qualifyingTier.discountValue) / 100);
    } else {
      // fixed_per_item
      discountPerItem = Math.min(qualifyingTier.discountValue, item.product.price);
    }
    result.discountAmount += discountPerItem * item.quantity;
    result.affectedItemIds.push(item.product._id.toString());
  }

  return result;
}

function calculateSpendThreshold(promo, cartItems, cartSubtotal, effectiveSubtotal) {
  const result = { discountAmount: 0, freeItems: [], shippingAdjustment: null, affectedItemIds: [] };
  const reward = promo.getReward;
  if (!reward || !reward.type) return result;

  const minAmount = promo.buyCondition?.minAmount || 0;
  if (cartSubtotal < minAmount) return result;

  switch (reward.type) {
    case "percentage_off": {
      result.discountAmount = Math.round((effectiveSubtotal * (reward.discountValue || 0)) / 100);
      if (reward.maxDiscountAmount) {
        result.discountAmount = Math.min(result.discountAmount, reward.maxDiscountAmount);
      }
      break;
    }
    case "fixed_off": {
      result.discountAmount = Math.min(reward.discountValue || 0, effectiveSubtotal);
      break;
    }
    case "free": {
      // Free product reward
      if (reward.productIds && reward.productIds.length > 0) {
        for (const pid of reward.productIds) {
          result.freeItems.push({
            productId: pid.toString(),
            quantity: reward.quantity || 1,
          });
        }
      }
      break;
    }
    case "free_shipping": {
      result.shippingAdjustment = 0;
      break;
    }
  }

  return result;
}

function calculateFixedPriceBundle(promo, cartItems) {
  const result = { discountAmount: 0, freeItems: [], shippingAdjustment: null, affectedItemIds: [] };
  const bundle = promo.fixedPriceBundle;
  if (!bundle || !bundle.productIds || bundle.productIds.length === 0) return result;

  const requiredProducts = bundle.productIds.map((id) => id.toString());
  const requiredQuantities = bundle.quantities || requiredProducts.map(() => 1);

  // Check all required products present in required quantities
  let originalTotal = 0;
  let allPresent = true;

  for (let i = 0; i < requiredProducts.length; i++) {
    const pid = requiredProducts[i];
    const requiredQty = requiredQuantities[i] || 1;
    const cartItem = cartItems.find((item) => item.product._id.toString() === pid);

    if (!cartItem || cartItem.quantity < requiredQty) {
      allPresent = false;
      break;
    }

    originalTotal += cartItem.product.price * requiredQty;
    result.affectedItemIds.push(pid);
  }

  if (!allPresent) return result;

  result.discountAmount = Math.max(0, originalTotal - (bundle.fixedPrice || 0));

  return result;
}

function calculateFreeGift(promo, cartItems, cartSubtotal) {
  const result = { discountAmount: 0, freeItems: [], shippingAdjustment: null, affectedItemIds: [] };
  const gift = promo.freeGift;
  if (!gift || !gift.productId) return result;

  // Check buy condition
  if (!passesBuyCondition(promo, cartItems, cartSubtotal)) return result;

  result.freeItems.push({
    productId: gift.productId.toString(),
    variantSize: gift.variantSize || null,
    quantity: gift.maxQuantity || 1,
  });

  return result;
}

function calculateTieredShipping(promo, cartSubtotal, shippingCost) {
  const result = { discountAmount: 0, freeItems: [], shippingAdjustment: null, affectedItemIds: [] };
  const tier = promo.shippingTier;
  if (!tier) return result;

  const minAmount = promo.buyCondition?.minAmount || 0;
  if (cartSubtotal < minAmount) return result;

  if (tier.discountType === "percentage") {
    const discount = Math.round((shippingCost * tier.discountValue) / 100);
    result.shippingAdjustment = Math.max(0, shippingCost - discount);
  } else {
    // fixed_rate: set shipping to this flat rate
    result.shippingAdjustment = tier.discountValue;
  }

  return result;
}

// --- Helpers ---

function getMatchingItems(buyCondition, cartItems) {
  if (!buyCondition || !buyCondition.type || buyCondition.type === "any") {
    return cartItems;
  }

  if (buyCondition.type === "product" && buyCondition.productIds?.length > 0) {
    const targetIds = buyCondition.productIds.map((id) => id.toString());
    return cartItems.filter((item) =>
      item.product?._id && targetIds.includes(item.product._id.toString())
    );
  }

  if (buyCondition.type === "category" && buyCondition.categoryIds?.length > 0) {
    const targetCats = buyCondition.categoryIds.map((id) => id.toString());
    return cartItems.filter((item) => {
      const productCat = item.product.category?.toString() || item.product.tag;
      return targetCats.includes(productCat);
    });
  }

  return cartItems;
}

module.exports = {
  findQualifyingAutoPromotions,
  validateSpecialCouponCode,
  calculatePromotionDiscount,
};
