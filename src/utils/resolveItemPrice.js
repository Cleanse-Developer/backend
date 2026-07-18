/**
 * Resolve the effective unit price for a cart/order line.
 *
 * Products carry a base `price` plus an optional `sizes[]` array of variants,
 * each with its own `price`. Carts store only the selected size LABEL string
 * (the same join key used by stock.service.js against `sizes.label`), so the
 * price must be resolved at pricing time.
 *
 * Returns the matching variant's price when a variant is selected and priced;
 * otherwise falls back to the base product price. A variant `price` of 0 is
 * honored (legit free/placeholder); only null/undefined falls back.
 *
 * @param {object} product - Populated product ({ price, sizes: [{ label, price }] }).
 * @param {string} [selectedSize] - Selected size label.
 * @returns {number} Effective unit price.
 */
function resolveItemPrice(product, selectedSize) {
  if (!product) return 0;
  if (selectedSize && Array.isArray(product.sizes) && product.sizes.length > 0) {
    const variant = product.sizes.find((s) => s.label === selectedSize);
    if (variant && typeof variant.price === "number" && !Number.isNaN(variant.price)) {
      return variant.price;
    }
  }
  return typeof product.price === "number" ? product.price : 0;
}

/**
 * True when a line CANNOT be safely priced from a variant and would silently
 * fall back to the base `product.price`. A product priced through variants
 * (`sizes[]` non-empty) must be purchased with a `selectedSize` that matches a
 * priced variant; otherwise resolveItemPrice returns the base price, which is
 * often a placeholder (e.g. ₹1) — that is the ₹1-charge hole. Charge paths call
 * this to reject such lines instead of charging the base price. A variant price
 * of 0 is a valid selection (honored, not rejected). Products with no variants
 * legitimately use the base price and are never flagged.
 *
 * @param {object} product - Populated product ({ price, sizes: [{ label, price }] }).
 * @param {string} [selectedSize] - Selected size label.
 * @returns {boolean} True when the line must be rejected (no priced variant match).
 */
function requiresVariantSelection(product, selectedSize) {
  if (!product || !Array.isArray(product.sizes) || product.sizes.length === 0) {
    return false;
  }
  const variant = selectedSize
    ? product.sizes.find((s) => s.label === selectedSize)
    : null;
  const priced =
    variant && typeof variant.price === "number" && !Number.isNaN(variant.price);
  return !priced;
}

module.exports = resolveItemPrice;
module.exports.resolveItemPrice = resolveItemPrice;
module.exports.requiresVariantSelection = requiresVariantSelection;
