const { Router } = require("express");
const { guestPricing } = require("../controllers/pricing.controller");

const router = Router();

// POST /api/pricing/guest — public guest pricing preview
router.post("/guest", guestPricing);

module.exports = router;
