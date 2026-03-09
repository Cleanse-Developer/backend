const { Router } = require("express");
const { checkDelivery } = require("../controllers/shipping.controller");

const router = Router();

// POST /api/shipping/check-delivery
router.post("/check-delivery", checkDelivery);

module.exports = router;
