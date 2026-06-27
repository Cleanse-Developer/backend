const { Router } = require("express");
const { checkDelivery, getShippingConfig } = require("../controllers/shipping.controller");
const { handleShiprocketTracking } = require("../controllers/shipping.webhook.controller");

const router = Router();

// GET /api/shipping/config
router.get("/config", getShippingConfig);

// POST /api/shipping/check-delivery
router.post("/check-delivery", checkDelivery);

// POST /api/shipping/tracking-callback — Shiprocket tracking webhook (public,
// x-api-key auth). URL deliberately avoids the keywords shiprocket/sr/kr/
// kartrocket, which Shiprocket rejects in callback URLs.
router.post("/tracking-callback", handleShiprocketTracking);

module.exports = router;
