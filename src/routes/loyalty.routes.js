const { Router } = require("express");
const {
  getBalance,
  getTransactions,
  getRedeemPreview,
  getMaxRedeemable,
} = require("../controllers/loyalty.controller");

const router = Router();

// All routes are protected (auth applied at parent index)
router.get("/balance", getBalance);
router.get("/transactions", getTransactions);
router.get("/max-redeemable", getMaxRedeemable);
router.post("/redeem/preview", getRedeemPreview);

module.exports = router;
