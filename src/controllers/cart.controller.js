const Cart = require("../models/Cart");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes totalStock",
};

// GET /api/cart
const getCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id }).populate(
    POPULATE_PRODUCT
  );

  res.json(
    ApiResponse.ok({
      cart: cart || { items: [] },
    })
  );
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

  res.json(ApiResponse.ok({ cart }, "Item added to cart"));
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

  res.json(ApiResponse.ok({ cart }, "Cart updated"));
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

  res.json(ApiResponse.ok({ cart }, "Item removed from cart"));
});

// POST /api/cart/clear
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    return res.json(ApiResponse.ok({ cart: { items: [] } }, "Cart is empty"));
  }

  cart.items = [];
  await cart.save();

  res.json(ApiResponse.ok({ cart }, "Cart cleared"));
});

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
