const { Router } = require("express");
const {
  listOrders,
  getOrder,
  updateOrderStatus,
  processRefund,
  approveReturn,
  addOrderNote,
} = require("../../controllers/admin/order.controller");
const srOps = require("../../controllers/admin/shiprocket.controller");

const router = Router();

router.get("/", listOrders);
router.get("/:id", getOrder);
router.patch("/:id/status", updateOrderStatus);
router.post("/:id/refund", processRefund);
router.patch("/:id/return", approveReturn);
router.patch("/:id/notes", addOrderNote);

// Per-order Shiprocket operations
router.post("/:id/shiprocket/sync", srOps.syncOrder);
router.post("/:id/shiprocket/assign-awb", srOps.assignAwb);
router.post("/:id/shiprocket/pickup", srOps.schedulePickup);
router.post("/:id/shiprocket/label", srOps.generateLabel);
router.post("/:id/shiprocket/manifest", srOps.generateManifest);
router.post("/:id/shiprocket/invoice", srOps.generateInvoice);
router.post("/:id/shiprocket/cancel", srOps.cancelShipment);
router.get("/:id/shiprocket/track", srOps.track);
router.post("/:id/shiprocket/ndr", srOps.ndrAction);
router.post("/:id/shiprocket/return", srOps.createReturn);
router.get("/:id/shiprocket/serviceability", srOps.orderServiceability);

module.exports = router;
