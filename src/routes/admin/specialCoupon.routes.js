const { Router } = require("express");
const {
  listSpecialCoupons,
  getSpecialCoupon,
  createSpecialCoupon,
  updateSpecialCoupon,
  deleteSpecialCoupon,
  cloneSpecialCoupon,
  getSpecialCouponUsage,
} = require("../../controllers/admin/specialCoupon.controller");

const router = Router();

router.get("/", listSpecialCoupons);
router.get("/:id", getSpecialCoupon);
router.post("/", createSpecialCoupon);
router.patch("/:id", updateSpecialCoupon);
router.delete("/:id", deleteSpecialCoupon);
router.post("/:id/clone", cloneSpecialCoupon);
router.get("/:id/usage", getSpecialCouponUsage);

module.exports = router;
