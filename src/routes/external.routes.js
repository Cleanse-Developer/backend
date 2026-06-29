const { Router } = require("express");
const {
  getOrdersByPhone,
  cancelOrderByOrderId,
  confirmOrders,
} = require("../controllers/external.controller");

const router = Router();

// GET /api/external/orders?phone=<number> — all orders for a phone number
router.get("/orders", getOrdersByPhone);

// POST /api/external/orders/cancel  body: { orderId } — cancel an order
router.post("/orders/cancel", cancelOrderByOrderId);

// POST /api/external/orders/confirm  body: { orderId? } — confirm one or all
// awaiting COD orders
router.post("/orders/confirm", confirmOrders);

module.exports = router;
