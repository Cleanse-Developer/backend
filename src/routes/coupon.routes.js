const { Router } = require("express");
const { auth } = require("../middleware/auth");
const {
  validateCoupon,
  getMyCoupons,
} = require("../controllers/coupon.controller");

const router = Router();

// POST /api/coupons/validate — validate a coupon code (guest-friendly)
router.post("/validate", validateCoupon);

// GET /api/coupons/my-coupons — get available coupons for the user (auth required)
router.get("/my-coupons", auth, getMyCoupons);

module.exports = router;
