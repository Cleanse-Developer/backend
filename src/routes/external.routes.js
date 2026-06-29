const { Router } = require("express");
const {
  getOrdersByPhone,
  cancelOrderByOrderId,
} = require("../controllers/external.controller");

const router = Router();

// GET /api/external/orders?phone=<number> — all orders for a phone number
router.get("/orders", getOrdersByPhone);

// POST /api/external/orders/cancel  body: { orderId } — cancel an order
router.post("/orders/cancel", cancelOrderByOrderId);

module.exports = router;
