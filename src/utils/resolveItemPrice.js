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

module.exports = resolveItemPrice;
