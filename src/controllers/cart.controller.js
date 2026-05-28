const Cart = require("../models/Cart");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { calculatePricing } = require("../services/pricing.service");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes totalStock",
};

/**
 * Helper: return cart with a pricing preview.
 * The preview uses no coupon — coupon is applied at checkout.
 */
const cartWithPricing = async (cart, userId) => {
  if (!cart || !cart.items.length) {
    return {
      cart: cart || { items: [] },
      pricing: null,
    };
  }
  const pricing = await calculatePricing(cart, null, userId, cart.giftWrap);
  return { cart, pricing };
};

// GET /api/cart
const getCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id }).populate(
    POPULATE_PRODUCT
  );

  const result = await cartWithPricing(cart, req.user._id);
  res.json(ApiResponse.ok(result));
});

// POST /api/cart/items
const addItem = asyncHandler(async (req, res) => {
  const { productId, quantity = 1, selectedSize } = req.body;

  let cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  // Check if item with same product + size already exists
  const existingIndex = cart.items.findIndex(
    (item) =>
      item.product.toString() === productId &&
      item.selectedSize === (selectedSize || undefined)
  );

  if (existingIndex > -1) {
    cart.items[existingIndex].quantity += quantity;
  } else {
    cart.items.push({
      product: productId,
      quantity,
      selectedSize,
    });
  }

  await cart.save();
  await cart.populate(POPULATE_PRODUCT);

  const result = await cartWithPricing(cart, req.user._id);
  res.json(ApiResponse.ok(result, "Item added to cart"));
});

// PATCH /api/cart/items/:itemId
const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    throw ApiError.notFound("Cart not found");
  }

  const item = cart.items.id(req.params.itemId);
  if (!item) {
    throw ApiError.notFound("Item not found in cart");
  }

  if (quantity <= 0) {
    cart.items.pull({ _id: req.params.itemId });
  } else {
    item.quantity = quantity;
  }

  await cart.save();
  await cart.populate(POPULATE_PRODUCT);

  const result = await cartWithPricing(cart, req.user._id);
  res.json(ApiResponse.ok(result, "Cart updated"));
});

// DELETE /api/cart/items/:itemId
const removeItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    throw ApiError.notFound("Cart not found");
  }

  cart.items.pull({ _id: req.params.itemId });

  await cart.save();
  await cart.populate(POPULATE_PRODUCT);

  const result = await cartWithPricing(cart, req.user._id);
  res.json(ApiResponse.ok(result, "Item removed from cart"));
});

// POST /api/cart/clear
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    return res.json(
      ApiResponse.ok({ cart: { items: [] }, pricing: null }, "Cart is empty")
    );
  }

  cart.items = [];
  await cart.save();

  res.json(ApiResponse.ok({ cart, pricing: null }, "Cart cleared"));
});

// POST /api/cart/preview-pricing -- preview pricing with coupon code + loyalty
const previewPricing = asyncHandler(async (req, res) => {
  const {
    couponCode,
    giftWrap,
    specialCouponCode,
    loyaltyPointsToRedeem = 0,
  } = req.body;

  const cart = await Cart.findOne({ user: req.user._id }).populate(
    POPULATE_PRODUCT
  );

  if (!cart || !cart.items.length) {
    throw ApiError.badRequest("Cart is empty");
  }

  const pricing = await calculatePricing(
    cart,
    couponCode || null,
    req.user._id,
    giftWrap != null ? giftWrap : cart.giftWrap,
    specialCouponCode || null,
    Number(loyaltyPointsToRedeem) || 0
  );

  res.json(ApiResponse.ok({ pricing }));
});

module.exports = { getCart, addItem, updateItem, removeItem, clearCart, previewPricing };
