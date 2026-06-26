const { Router } = require("express");
const { checkDelivery, getShippingConfig } = require("../controllers/shipping.controller");

const router = Router();

// GET /api/shipping/config
router.get("/config", getShippingConfig);

// POST /api/shipping/check-delivery
router.post("/check-delivery", checkDelivery);

module.exports = router;
