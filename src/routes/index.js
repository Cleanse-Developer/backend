const { Router } = require("express");
const { auth, optionalAuth } = require("../middleware/auth");
const { authLimiter, adminLimiter } = require("../middleware/rateLimiter");
const roleGuard = require("../middleware/roleGuard");

const router = Router();

// Public routes
router.use("/auth", authLimiter, require("./auth.routes"));
router.use("/products", require("./product.routes"));
router.use("/blogs", require("./blog.routes"));
router.use("/categories", require("./category.routes"));
router.use("/testimonials", require("./testimonial.routes"));
router.use("/social-proof", require("./socialProof.routes"));
router.use("/spin-wheel", require("./spinWheel.routes"));
router.use("/settings", require("./settings.routes"));
router.use("/newsletter", require("./newsletter.routes"));
router.use("/contact", require("./contact.routes"));
router.use("/shipping", require("./shipping.routes"));
router.use("/bundles", require("./bundle.routes"));
router.use("/pricing", require("./pricing.routes"));
router.use("/special-coupons", require("./specialCoupon.routes").publicRouter);
router.use("/referral", require("./referral.routes").publicRouter);

// Public webhook route (must be before auth middleware)
router.use("/payments/webhook", require("./payment.routes").webhookRouter);
router.use("/whatsapp/webhook", require("./whatsapp.routes").webhookRouter);

// Protected customer routes
router.use("/checkout", auth, require("./checkout.routes"));
router.use("/cart", auth, require("./cart.routes"));
router.use("/orders", auth, require("./order.routes"));
router.use("/user", auth, require("./user.routes"));
router.use("/addresses", auth, require("./address.routes"));
router.use("/wishlist", auth, require("./wishlist.routes"));
router.use("/reviews", auth, require("./review.routes"));
router.use("/coupons", optionalAuth, require("./coupon.routes"));
router.use("/special-coupons", optionalAuth, require("./specialCoupon.routes"));
router.use("/payments", auth, require("./payment.routes"));
router.use("/referral", auth, require("./referral.routes"));
router.use("/loyalty", auth, require("./loyalty.routes"));

// Admin routes
router.use("/admin", adminLimiter, require("./admin/index"));

module.exports = router;
