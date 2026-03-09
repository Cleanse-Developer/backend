const { Router } = require("express");
const {
  placeOrder,
  getMyOrders,
  requestReturn,
  reorder,
} = require("../controllers/order.controller");
const { placeOrderRules, returnRules } = require("../validators/order.validator");
const validate = require("../middleware/validate");

const router = Router();

// POST /api/orders — place a new order (COD)
router.post("/", placeOrderRules, validate, placeOrder);

// GET /api/orders/my-orders — get current user's orders
router.get("/my-orders", getMyOrders);

// POST /api/orders/:orderId/return — request a return
router.post("/:orderId/return", returnRules, validate, requestReturn);

// POST /api/orders/:orderId/reorder — reorder items from a past order
router.post("/:orderId/reorder", reorder);

module.exports = router;
