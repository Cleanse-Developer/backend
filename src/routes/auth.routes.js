const { Router } = require("express");
const { sendOtp, verifyOtp, verifyWidgetToken, googleAuth, linkPhone, linkEmail, loginWithPassword, register, refresh, logout, checkAccount } = require("../controllers/auth.controller");
const { sendOtpRules, verifyOtpRules, verifyWidgetTokenRules, googleAuthRules, linkPhoneRules, linkEmailRules, loginRules, registerRules, checkAccountRules } = require("../validators/auth.validator");
const validate = require("../middleware/validate");
const { auth } = require("../middleware/auth");

const router = Router();

router.post("/send-otp", sendOtpRules, validate, sendOtp);
router.post("/login", loginRules, validate, loginWithPassword);
router.post("/verify-otp", verifyOtpRules, validate, verifyOtp);
router.post("/verify-widget-token", verifyWidgetTokenRules, validate, verifyWidgetToken);
router.post("/google", googleAuthRules, validate, googleAuth);
router.post("/link-phone", auth, linkPhoneRules, validate, linkPhone);
router.post("/link-email", auth, linkEmailRules, validate, linkEmail);
router.post("/register", registerRules, validate, register);
router.post("/check-account", checkAccountRules, validate, checkAccount);
router.post("/refresh", refresh);
router.post("/logout", logout);

module.exports = router;
