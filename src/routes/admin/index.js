const { Router } = require("express");
const { auth } = require("../../middleware/auth");
const roleGuard = require("../../middleware/roleGuard");
const { authLimiter } = require("../../middleware/rateLimiter");
const { ROLES } = require("../../utils/constants");

const router = Router();

// Admin auth (no auth middleware needed for login)
router.use("/auth", authLimiter, require("./auth.routes"));

// All other admin routes require auth + admin/manager/support role
router.use(auth);
router.use(roleGuard(ROLES.ADMIN, ROLES.MANAGER, ROLES.SUPPORT));

router.use("/products", require("./product.routes"));
router.use("/categories", require("./category.routes"));
router.use("/orders", require("./order.routes"));
router.use("/customers", require("./customer.routes"));
router.use("/coupons", require("./coupon.routes"));
router.use("/blogs", require("./blog.routes"));
router.use("/testimonials", require("./testimonial.routes"));
router.use("/dashboard", require("./dashboard.routes"));
router.use("/settings", require("./settings.routes"));
router.use("/tickets", require("./ticket.routes"));
router.use("/shipping", require("./shipping.routes"));
router.use("/bundles", require("./bundle.routes"));
router.use("/cms", require("./cms.routes"));
router.use("/spin-wheel", require("./spinWheel.routes"));
router.use("/newsletter", require("./newsletter.routes"));
router.use("/special-coupons", require("./specialCoupon.routes"));
router.use("/loyalty", require("./loyalty.routes"));
router.use("/referrals", require("./referral.routes"));
router.use("/reviews", require("./review.routes"));

module.exports = router;
