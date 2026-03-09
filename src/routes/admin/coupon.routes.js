const { Router } = require("express");
const {
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require("../../controllers/admin/coupon.controller");

const router = Router();

router.get("/", listCoupons);
router.post("/", createCoupon);
router.patch("/:id", updateCoupon);
router.delete("/:id", deleteCoupon);

module.exports = router;
