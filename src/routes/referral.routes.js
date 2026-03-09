const { Router } = require("express");
const { getReferralCode } = require("../controllers/referral.controller");

const router = Router();

// GET /api/referral/code — get or generate referral code (protected, auth applied in index)
router.get("/code", getReferralCode);

module.exports = router;
