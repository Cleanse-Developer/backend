const { Router } = require("express");
const {
  listOrders,
  getOrder,
  updateOrderStatus,
  processRefund,
  approveReturn,
  addOrderNote,
} = require("../../controllers/admin/order.controller");

const router = Router();

router.get("/", listOrders);
router.get("/:id", getOrder);
router.patch("/:id/status", updateOrderStatus);
router.post("/:id/refund", processRefund);
router.patch("/:id/return", approveReturn);
router.patch("/:id/notes", addOrderNote);

module.exports = router;
