const { Router } = require("express");
const { getBalance } = require("../controllers/loyalty.controller");

const router = Router();

// GET /api/loyalty/balance — get loyalty points balance and recent transactions (protected, auth applied in index)
router.get("/balance", getBalance);

module.exports = router;
