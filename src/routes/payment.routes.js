const { Router } = require("express");
const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleWebhook,
} = require("../controllers/payment.controller");

const router = Router();
const webhookRouter = Router();

// POST /api/payments/razorpay/create — create Razorpay order (auth-protected)
router.post("/razorpay/create", createRazorpayOrder);

// POST /api/payments/razorpay/verify — verify Razorpay payment (auth-protected)
router.post("/razorpay/verify", verifyRazorpayPayment);

// Webhook router (public, no auth)
// POST /api/payments/webhook — Razorpay webhook callback
webhookRouter.post("/", handleWebhook);

module.exports = router;
module.exports.webhookRouter = webhookRouter;
