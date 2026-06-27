const { Router } = require("express");
const srOps = require("../../controllers/admin/shiprocket.controller");

const router = Router();

// Account-level Shiprocket operations (admin Settings UI)
router.get("/pickup", srOps.listPickup);
router.post("/pickup", srOps.addPickup);
router.get("/couriers", srOps.couriers);
router.get("/wallet", srOps.wallet);
router.post("/serviceability", srOps.serviceability);

module.exports = router;
