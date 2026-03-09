const { Router } = require("express");
const { sendOtp, verifyOtp, register, refresh, logout } = require("../controllers/auth.controller");
const { sendOtpRules, verifyOtpRules, registerRules } = require("../validators/auth.validator");
const validate = require("../middleware/validate");

const router = Router();

router.post("/send-otp", sendOtpRules, validate, sendOtp);
router.post("/verify-otp", verifyOtpRules, validate, verifyOtp);
router.post("/register", registerRules, validate, register);
router.post("/refresh", refresh);
router.post("/logout", logout);

module.exports = router;
