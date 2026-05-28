const { Router } = require("express");
const {
  getReferralCode,
  validateReferralCode,
  getReferralHistory,
} = require("../controllers/referral.controller");

// Public routes (no auth) — used pre-signup
const publicRouter = Router();
publicRouter.post("/validate", validateReferralCode);

// Protected routes (auth applied at parent index)
const protectedRouter = Router();
protectedRouter.get("/code", getReferralCode);
protectedRouter.get("/history", getReferralHistory);

module.exports = protectedRouter;
module.exports.publicRouter = publicRouter;
