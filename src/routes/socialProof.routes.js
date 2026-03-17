const { Router } = require("express");
const { getRecentPurchases } = require("../controllers/socialProof.controller");

const router = Router();

// GET /api/social-proof/recent-purchases
router.get("/recent-purchases", getRecentPurchases);

module.exports = router;
