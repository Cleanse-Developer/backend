const { Router } = require("express");
const {
  validateCoupon,
  getMyCoupons,
} = require("../controllers/coupon.controller");

const router = Router();

// POST /api/coupons/validate — validate a coupon code
router.post("/validate", validateCoupon);

// GET /api/coupons/my-coupons — get available coupons for the user
router.get("/my-coupons", getMyCoupons);

module.exports = router;
