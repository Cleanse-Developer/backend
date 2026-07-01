const Bundle = require("../models/Bundle");
const User = require("../models/User");
const ShippingZone = require("../models/ShippingZone");
const Settings = require("../models/Settings");
const { validateCoupon } = require("./coupon.service");
const { resolvePromotions } = require("./promotionResolver.service");
const {
  getLoyaltyConfig,
  calculateMaxRedeemable,
} = require("./loyalty.service");
const {
  DISCOUNT_TIERS,
  SHIPPING,
  GIFT_WRAP_COST,
} = require("../utils/constants");
const resolveItemPrice = require("../utils/resolveItemPrice");

/**
 * Default cart-tier-discount config, built from the hardcoded constants.
 * Used as the fallback when no `discount_tier_config` setting exists in the DB.
 * Percent tiers come from DISCOUNT_TIERS; the free-shipping milestone comes from
 * SHIPPING.FREE_THRESHOLD.
 */
const DEFAULT_TIER_CONFIG = {
  enabled: true,
  tiers: [
    ...DISCOUNT_TIERS.map((t) => ({
      threshold: t.threshold,
      type: "percent",
      percent: t.percent,
      label: t.label,
    })),
    {
      threshold: SHIPPING.FREE_THRESHOLD,
      type: "free_shipping",
      label: "Free Shipping",
    },
  ],
};

/**
 * Read the admin-managed cart-tier-discount config from the Settings collection.
 * Falls back to DEFAULT_TIER_CONFIG (derived from constants) when unset/invalid.
 * Read fresh on every call (matches getLoyaltyConfig); admin saves are infrequent.
 *
 * @returns {Promise<{ enabled: boolean, tiers: Array<{threshold:number, type:string, percent?:number, label:string}> }>}
 */
const getDiscountTierConfig = async () => {
  const doc = await Settings.findOne({ key: "discount_tier_config" }).lean();
  if (!doc?.value || !Array.isArray(doc.value.tiers)) {
    return DEFAULT_TIER_CONFIG;
  }
  return {
    enabled: doc.value.enabled !== false,
    tiers: doc.value.tiers,
  };
};

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
        (sum, item) => sum + resolveItemPrice(item.product, item.selectedSize) * item.quantity,
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
      (sum, item) => sum + resolveItemPrice(item.product, item.selectedSize) * item.quantity,
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
 * Resolve the active shipping rate + free-shipping threshold.
 *
 * Source of truth is the admin-configured ShippingZone collection, NOT the
 * hardcoded SHIPPING constants (those are only a last-resort fallback when no
 * zone exists yet).
 *
 * Resolution: if the delivery address belongs to a shipping zone, use that
 * zone's rate; otherwise fall back to the GLOBAL standard rate (admin Settings).
 * Zone membership = the zone's pincodes include the delivery pincode, OR (for
 * state-wide zones) the zone's states include the delivery state. An address in
 * NO zone always uses the global rate — there is no "first zone" catch-all.
 *
 * Resolution order:
 *   1. Zone whose pincodes include location.pincode
 *   2. Zone whose states include location.state  (state-wide zones)
 *   3. GLOBAL SHIPPING constants (rate + free threshold)
 *
 * @param {{ pincode?: string, state?: string } | null} location
 * @param {string} paymentMethod - "cod" | "razorpay" | "upi" | null. Selects the
 *   per-method rate/threshold bucket ("cod" vs "prepaid"). Unknown → prepaid.
 * @returns {Promise<{ standardRate: number, freeAbove: number, zone: string|null }>}
 */
// Normalize a payment method into a shipping bucket. COD has its own rate +
// free threshold; everything else (razorpay, upi, null) is treated as prepaid.
const normalizeMethod = (method) => (method === "cod" ? "cod" : "prepaid");

// Global per-method shipping (rate + free threshold) from admin Settings (key
// "SHIPPING"). Current shape: { prepaid: {STANDARD_RATE, FREE_THRESHOLD}, cod: {…} }.
// Falls back to the legacy flat shape ({STANDARD_RATE, FREE_THRESHOLD}), then to
// the hardcoded SHIPPING constants — so pre-split installs keep working.
const getGlobalShipping = async (method) => {
  const doc = await Settings.findOne({ key: "SHIPPING" }).lean();
  const val = doc?.value || {};
  const bucket = val[method] || {};

  const rate = Number(bucket.STANDARD_RATE ?? val.STANDARD_RATE);
  const free = Number(bucket.FREE_THRESHOLD ?? val.FREE_THRESHOLD);

  return {
    standardRate: Number.isFinite(rate) ? rate : SHIPPING.STANDARD_RATE,
    freeAbove: Number.isFinite(free) ? free : SHIPPING.FREE_THRESHOLD,
  };
};

const resolveShippingConfig = async (location = null, paymentMethod = "prepaid") => {
  const method = normalizeMethod(paymentMethod);
  const global = await getGlobalShipping(method);
  const globalConfig = {
    standardRate: global.standardRate,
    freeAbove: global.freeAbove,
    zone: null,
  };

  const pincode = location?.pincode ? String(location.pincode).trim() : null;
  const state = location?.state ? String(location.state).trim().toLowerCase() : null;

  // No location to match on → global.
  if (!pincode && !state) return globalConfig;

  const zones = await ShippingZone.find({ isActive: true })
    .select("name pincodes states rates")
    .lean();
  if (!zones.length) return globalConfig;

  // Pincode match first (precise), then state-wide zone. No match → global.
  const zone =
    (pincode && zones.find((z) => z.pincodes?.includes(pincode))) ||
    (state &&
      zones.find((z) => z.states?.some((s) => s.trim().toLowerCase() === state))) ||
    null;

  if (!zone) return globalConfig;

  const r = zone.rates || {};
  const methodRates = r[method] || {};
  // Per-method zone rate wins; else the zone's legacy standard/freeAbove; else
  // the resolved global per-method value.
  return {
    standardRate: methodRates.standard ?? r.standard ?? global.standardRate,
    freeAbove: methodRates.freeAbove ?? r.freeAbove ?? global.freeAbove,
    zone: zone.name || null,
  };
};

/**
 * Calculate complete pricing breakdown for an order.
 *
 * Discount application order:
 * 1. Subtotal = sum of all item prices
 * 2. Bundle discounts = per-bundle discounts on qualifying product groups
 * 3. Tier discount = percentage off the FULL subtotal (based on cart value tiers)
 * 4. Special coupon discounts (BXGY, volume, spend threshold, etc.)
 * 5. Regular coupon discount = additional code-based discount (if not blocked by special promos)
 * 6. Shipping = standard rate or free above threshold (with special promo adjustments)
 * 7. Gift wrap = optional flat fee
 * 8. Total = subtotal - all discounts + shipping + giftWrap
 *
 * Note: tier discount threshold is checked against the original subtotal (not after bundle discount).
 * This keeps the progress bar experience consistent -- user sees "spend X more for Y% off".
 *
 * @param {object} cart - Cart document with populated items (items[].product must have .price)
 * @param {string|null} couponCode - Regular coupon code to apply (optional)
 * @param {string} userId - User ID for coupon validation
 * @param {boolean} giftWrap - Whether gift wrap is requested
 * @param {string|null} specialCouponCode - Special promotion code to apply (optional)
 * @returns {Promise<object>} Pricing breakdown
 */
const calculatePricing = async (
  cart,
  couponCode,
  userId,
  giftWrap = false,
  specialCouponCode = null,
  loyaltyPointsToRedeem = 0,
  shippingLocation = null,
  paymentMethod = "prepaid"
) => {
  // 1. Calculate subtotal
  const subtotal = cart.items.reduce((sum, item) => {
    return sum + resolveItemPrice(item.product, item.selectedSize) * item.quantity;
  }, 0);

  // 2. Calculate bundle discounts
  const { bundleDiscounts, bundleDiscountTotal } =
    await calculateBundleDiscounts(cart.items);

  // 3. Find applicable tier discount (highest qualifying tier)
  // Tiers are admin-managed (Settings: discount_tier_config); fall back to
  // constants when unset. Tier is based on original subtotal.
  const tierCfg = await getDiscountTierConfig();

  let tierDiscount = 0;
  let tierPercent = 0;
  let tierLabel = null;

  if (tierCfg.enabled) {
    const percentTiers = tierCfg.tiers
      .filter((t) => t.type === "percent" && Number(t.percent) > 0)
      .sort((a, b) => b.threshold - a.threshold); // descending

    for (const tier of percentTiers) {
      if (subtotal >= tier.threshold) {
        tierPercent = tier.percent;
        tierLabel = tier.label;
        tierDiscount = Math.round((subtotal * tier.percent) / 100);
        break;
      }
    }
  }

  // 4. Resolve special promotions (automatic + code-based)
  // Effective subtotal after bundles + tier
  const effectiveAfterBundleTier = Math.max(0, subtotal - bundleDiscountTotal - tierDiscount);

  // Shipping cost (base, before any adjustments). Rate + free-shipping threshold
  // come from the admin-configured per-method shipping config (global Settings
  // "SHIPPING" → matched ShippingZone), selected by paymentMethod (cod vs prepaid).
  // NOTE: the cart progress bar's "free shipping" milestone is still driven by
  // discount_tier_config (see calculateTierProgress) and is method-agnostic, so it
  // may differ from the actual per-method freeAbove resolved here — the resolved
  // value is always authoritative for the charge.
  const { standardRate, freeAbove } = await resolveShippingConfig(
    shippingLocation,
    paymentMethod
  );
  const baseShippingCost = subtotal >= freeAbove ? 0 : standardRate;

  const promotionResult = await resolvePromotions(
    cart.items,
    userId,
    subtotal,
    effectiveAfterBundleTier,
    baseShippingCost,
    specialCouponCode,
    couponCode
  );

  const specialCouponDiscounts = promotionResult.applicableSpecialPromotions;
  const specialCouponDiscountTotal = promotionResult.specialCouponDiscountTotal;

  // 5. Validate and calculate regular coupon discount
  // Coupon applies to the effective amount (after bundles + tier + special promos)
  let couponDiscount = 0;
  let appliedCouponCode = null;
  let couponDescription = null;
  let couponDiscountType = null;

  if (couponCode && promotionResult.regularCouponAllowed) {
    const effectiveSubtotal = Math.max(
      0,
      subtotal - bundleDiscountTotal - tierDiscount - specialCouponDiscountTotal
    );
    const couponResult = await validateCoupon(
      couponCode,
      userId,
      subtotal, // min order check against original subtotal
      effectiveSubtotal, // actual amount for discount calculation
      cart.items // cart items for applicableProducts/applicableCategories filtering
    );
    if (couponResult.valid) {
      couponDiscount = couponResult.discount;
      appliedCouponCode = couponCode.toUpperCase();
      couponDescription = couponResult.description;
      couponDiscountType = couponResult.discountType;
    }
  }

  // 6. Shipping cost (with adjustments from special promos and regular coupon)
  let effectiveShippingCost = baseShippingCost;

  // Special promo shipping adjustment
  if (promotionResult.shippingAdjustment !== null) {
    effectiveShippingCost = promotionResult.shippingAdjustment;
  }

  // Handle free_shipping regular coupon type
  if (couponDiscountType === "free_shipping") {
    effectiveShippingCost = 0;
  }

  // 7. Gift wrap cost
  const giftWrapCost = giftWrap ? GIFT_WRAP_COST : 0;

  // 8. Loyalty points redemption (after coupon discounts, before shipping)
  let loyaltyDiscount = 0;
  let loyaltyPointsRedeemed = 0;
  let maxRedeemablePoints = 0;
  let loyaltyConfig = null;

  if (userId) {
    loyaltyConfig = await getLoyaltyConfig();
    if (loyaltyConfig.enabled) {
      const subtotalAfterDiscounts = Math.max(
        0,
        subtotal - bundleDiscountTotal - tierDiscount - specialCouponDiscountTotal - couponDiscount
      );

      const user = await User.findById(userId).select("loyaltyPoints").lean();
      const userBalance = user?.loyaltyPoints || 0;

      const maxInfo = calculateMaxRedeemable(
        userBalance,
        subtotalAfterDiscounts,
        loyaltyConfig
      );
      maxRedeemablePoints = maxInfo.maxPoints;

      // Strict validation: must be a positive integer at/above min and at/below max
      const requested = Math.floor(Number(loyaltyPointsToRedeem) || 0);
      if (
        requested > 0 &&
        requested >= loyaltyConfig.minRedemptionPoints &&
        requested <= maxInfo.maxPoints
      ) {
        loyaltyPointsRedeemed = requested;
        // Floor to whole rupees so totals remain integer-safe across the pipeline
        loyaltyDiscount = Math.floor(
          loyaltyPointsRedeemed * loyaltyConfig.redeemRatePerPoint
        );
        // Never let discount exceed remaining subtotal after other discounts
        loyaltyDiscount = Math.min(loyaltyDiscount, subtotalAfterDiscounts);
      }
    }
  }

  // 9. Cap combined discounts so they never exceed subtotal
  const totalDiscounts =
    bundleDiscountTotal +
    tierDiscount +
    specialCouponDiscountTotal +
    couponDiscount +
    loyaltyDiscount;
  const cappedDiscounts = Math.min(totalDiscounts, subtotal);

  // 10. Total (never below 0)
  const total = Math.max(
    0,
    subtotal - cappedDiscounts + effectiveShippingCost + giftWrapCost
  );

  // 11. Loyalty points earned on this order (uses configured rate against final total)
  const earnRate = loyaltyConfig?.earnRatePerRupee ?? 0.1;
  const loyaltyPoints = Math.floor(total * earnRate);

  // 10. Tier progress info for the UI progress bar (null when tiers disabled)
  const tierProgress = calculateTierProgress(subtotal, tierCfg);

  return {
    subtotal,
    bundleDiscounts,
    bundleDiscountTotal,
    tierDiscount,
    tierPercent,
    tierLabel,
    specialCouponDiscounts,
    specialCouponDiscountTotal,
    freeGifts: promotionResult.freeGifts,
    promotionMessages: promotionResult.messages,
    couponDiscount,
    couponCode: appliedCouponCode,
    couponDescription,
    shippingCost: effectiveShippingCost,
    giftWrapCost,
    loyaltyDiscount,
    loyaltyPointsRedeemed,
    maxRedeemablePoints,
    total,
    loyaltyPoints,
    tierProgress,
  };
};

/**
 * Build render-ready tier-progress for the storefront cart progress bar.
 * Returns null when tiers are disabled or none are configured (bar hidden).
 *
 * @param {number} subtotal
 * @param {{ enabled: boolean, tiers: Array }} tierCfg
 * @returns {null | {
 *   enabled: true,
 *   milestones: Array<{ threshold:number, label:string, type:string, percent:number|null, reached:boolean }>,
 *   nextMilestone: { threshold:number, label:string, type:string, amountAway:number } | null,
 *   currentLabel: string | null,
 *   fillPercent: number,
 * }}
 */
const calculateTierProgress = (subtotal, tierCfg) => {
  if (!tierCfg?.enabled || !Array.isArray(tierCfg.tiers)) return null;

  const milestones = tierCfg.tiers
    .filter((t) => t && Number(t.threshold) > 0)
    .sort((a, b) => a.threshold - b.threshold) // ascending for the bar
    .map((t) => ({
      threshold: t.threshold,
      label: t.label,
      type: t.type === "free_shipping" ? "free_shipping" : "percent",
      percent: t.type === "free_shipping" ? null : t.percent ?? null,
      reached: subtotal >= t.threshold,
    }));

  if (!milestones.length) return null;

  const nextMilestone = milestones.find((m) => !m.reached) || null;
  const reached = milestones.filter((m) => m.reached);
  const currentLabel = reached.length ? reached[reached.length - 1].label : null;
  const maxThreshold = milestones[milestones.length - 1].threshold;
  const fillPercent =
    maxThreshold > 0
      ? Math.min(100, Math.round((subtotal / maxThreshold) * 100))
      : 0;

  return {
    enabled: true,
    milestones,
    nextMilestone: nextMilestone
      ? {
          threshold: nextMilestone.threshold,
          label: nextMilestone.label,
          type: nextMilestone.type,
          amountAway: Math.max(0, nextMilestone.threshold - subtotal),
        }
      : null,
    currentLabel,
    fillPercent,
  };
};

module.exports = {
  calculatePricing,
  calculateBundleDiscounts,
  calculateTierProgress,
  resolveShippingConfig,
  getDiscountTierConfig,
};
