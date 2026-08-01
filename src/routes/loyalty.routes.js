const { Router } = require("express");
const {
  getBalance,
  getTransactions,
  getRedeemPreview,
  getMaxRedeemable,
  getConfig,
} = require("../controllers/loyalty.controller");

const router = Router();
const publicRouter = Router();

// Protected routes (auth applied at parent index)
router.get("/balance", getBalance);
router.get("/transactions", getTransactions);
router.get("/max-redeemable", getMaxRedeemable);
router.post("/redeem/preview", getRedeemPreview);

// Public routes (no auth needed)
publicRouter.get("/config", getConfig);

module.exports = router;
module.exports.publicRouter = publicRouter;
