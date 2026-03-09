const { Router } = require("express");
const { auth } = require("../middleware/auth");
const { authLimiter, adminLimiter } = require("../middleware/rateLimiter");
const roleGuard = require("../middleware/roleGuard");

const router = Router();

// Public routes
router.use("/auth", authLimiter, require("./auth.routes"));
router.use("/products", require("./product.routes"));
router.use("/blogs", require("./blog.routes"));
router.use("/newsletter", require("./newsletter.routes"));
router.use("/contact", require("./contact.routes"));
router.use("/shipping", require("./shipping.routes"));

// Public webhook route (must be before auth middleware)
router.use("/payments/webhook", require("./payment.routes").webhookRouter);

// Protected customer routes
router.use("/cart", auth, require("./cart.routes"));
router.use("/orders", auth, require("./order.routes"));
router.use("/user", auth, require("./user.routes"));
router.use("/addresses", auth, require("./address.routes"));
router.use("/wishlist", auth, require("./wishlist.routes"));
router.use("/reviews", auth, require("./review.routes"));
router.use("/coupons", auth, require("./coupon.routes"));
router.use("/payments", auth, require("./payment.routes"));
router.use("/referral", auth, require("./referral.routes"));
router.use("/loyalty", auth, require("./loyalty.routes"));

// Admin routes
router.use("/admin", adminLimiter, require("./admin/index"));

module.exports = router;
