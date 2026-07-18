const { Router } = require("express");
const { optionalAuth } = require("../middleware/auth");
const { getPrizes, checkSpin, spin, claim } = require("../controllers/spinWheel.controller");

const router = Router();

// GET /api/spin-wheel/prizes — public, returns active prizes for wheel rendering
router.get("/prizes", getPrizes);

// GET /api/spin-wheel/check?email=X — public, check if email already spun
router.get("/check", checkSpin);

// POST /api/spin-wheel — spin the wheel anonymously (no email; returns a token)
router.post("/", optionalAuth, spin);

// POST /api/spin-wheel/claim — claim the spun reward against an email
router.post("/claim", optionalAuth, claim);

module.exports = router;
