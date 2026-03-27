const { Router } = require("express");
const { validateCode, getActivePromotions } = require("../controllers/specialCoupon.controller");

const router = Router();
const publicRouter = Router();

// Protected routes (require auth)
router.post("/validate", validateCode);

// Public routes (no auth needed -- active promotions visible to everyone)
publicRouter.get("/active-promotions", getActivePromotions);

module.exports = router;
module.exports.publicRouter = publicRouter;
