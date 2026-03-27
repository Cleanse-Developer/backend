const { Router } = require("express");
const { optionalAuth } = require("../middleware/auth");
const { getPrizes, checkSpin, spin } = require("../controllers/spinWheel.controller");

const router = Router();

// GET /api/spin-wheel/prizes — public, returns active prizes for wheel rendering
router.get("/prizes", getPrizes);

// GET /api/spin-wheel/check?email=X — public, check if email already spun
router.get("/check", checkSpin);

// POST /api/spin-wheel — spin the wheel (optionalAuth to link logged-in users)
router.post("/", optionalAuth, spin);

module.exports = router;
