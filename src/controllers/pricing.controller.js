const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { calculatePricing } = require("../services/pricing.service");

/**
 * POST /api/pricing/guest
 * Public (no auth) endpoint — calculates full pricing for a guest cart.
 * Accepts cart items from localStorage, looks up real prices from DB,
 * and runs the same pricing engine as authenticated users.
 *
 * Body: { items: [{ productId, quantity, selectedSize? }], couponCode?, giftWrap? }
 */
const guestPricing = asyncHandler(async (req, res) => {
  const { items, couponCode, specialCouponCode, giftWrap } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest("items array is required and must not be empty");
  }

  if (items.length > 50) {
    throw ApiError.badRequest("Too many items");
  }

  // Extract product IDs and validate format
  const productIds = items.map((item) => item.productId).filter(Boolean);
  if (productIds.length !== items.length) {
    throw ApiError.badRequest("Each item must have a productId");
  }

  // Fetch real product data from DB (source of truth for prices)
  const products = await Product.find({
    _id: { $in: productIds },
    isActive: true,
  })
    .select("_id name price sizes")
    .lean();

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  // Build a virtual cart that matches the shape calculatePricing expects
  const virtualItems = [];
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) continue; // skip invalid/inactive products silently

    const quantity = Math.max(1, Math.min(99, Number(item.quantity) || 1));
    virtualItems.push({
      product: { _id: product._id, price: product.price, sizes: product.sizes },
      quantity,
      selectedSize: item.selectedSize || undefined,
    });
  }

  if (virtualItems.length === 0) {
    throw ApiError.badRequest("No valid products found");
  }

  // Build a virtual cart object matching the shape calculatePricing expects
  const virtualCart = { items: virtualItems };

  // Run the same pricing engine — pass null for coupon userId (guest can't use user-specific coupons)
  const pricing = await calculatePricing(
    virtualCart,
    couponCode || null,
    null, // no userId for guest
    giftWrap || false,
    specialCouponCode || null
  );

  res.json(ApiResponse.ok({ pricing }));
});

module.exports = { guestPricing };
