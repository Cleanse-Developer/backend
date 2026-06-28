const { Router } = require("express");
const srOps = require("../../controllers/admin/shiprocket.controller");

const router = Router();

// Account-level Shiprocket operations (admin Settings UI)
router.get("/pickup", srOps.listPickup);
router.post("/pickup", srOps.addPickup);
router.get("/couriers", srOps.couriers);
router.get("/wallet", srOps.wallet);
router.post("/serviceability", srOps.serviceability);

// Live/Test mode toggle (Developer Options)
router.get("/mode", srOps.getMode);
router.patch("/mode", srOps.setMode);

// Operational config (pickup, warehouse, courier, NDR, package, alert email)
router.get("/config", srOps.getConfig);
router.patch("/config", srOps.setConfig);

module.exports = router;
