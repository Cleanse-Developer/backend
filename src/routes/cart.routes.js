const { Router } = require("express");
const {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
} = require("../controllers/cart.controller");
const { addItemRules, updateItemRules } = require("../validators/cart.validator");
const validate = require("../middleware/validate");

const router = Router();

// GET /api/cart — get user's cart
router.get("/", getCart);

// POST /api/cart/items — add item to cart
router.post("/items", addItemRules, validate, addItem);

// PATCH /api/cart/items/:itemId — update item quantity
router.patch("/items/:itemId", updateItemRules, validate, updateItem);

// DELETE /api/cart/items/:itemId — remove item from cart
router.delete("/items/:itemId", removeItem);

// POST /api/cart/clear — clear all items
router.post("/clear", clearCart);

module.exports = router;
