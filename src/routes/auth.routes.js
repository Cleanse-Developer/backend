const { Router } = require("express");
const { sendOtp, verifyOtp, verifyWidgetToken, loginWithPassword, register, refresh, logout, checkAccount } = require("../controllers/auth.controller");
const { sendOtpRules, verifyOtpRules, verifyWidgetTokenRules, loginRules, registerRules, checkAccountRules } = require("../validators/auth.validator");
const validate = require("../middleware/validate");

const router = Router();

router.post("/send-otp", sendOtpRules, validate, sendOtp);
router.post("/login", loginRules, validate, loginWithPassword);
router.post("/verify-otp", verifyOtpRules, validate, verifyOtp);
router.post("/verify-widget-token", verifyWidgetTokenRules, validate, verifyWidgetToken);
router.post("/register", registerRules, validate, register);
router.post("/check-account", checkAccountRules, validate, checkAccount);
router.post("/refresh", refresh);
router.post("/logout", logout);

module.exports = router;
