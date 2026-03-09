const bcrypt = require("bcryptjs");
const OTP = require("../models/OTP");

const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 3;

const generateOTP = () => {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
};

const createOTP = async (identifier, purpose = "login") => {
  // Remove any existing OTPs for this identifier + purpose
  await OTP.deleteMany({ identifier, purpose });

  const plainOtp = generateOTP();
  const hashedOtp = await bcrypt.hash(plainOtp, 10);

  await OTP.create({
    identifier,
    otp: hashedOtp,
    purpose,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
  });

  return plainOtp;
};

const verifyOTP = async (identifier, plainOtp, purpose = "login") => {
  const otpRecord = await OTP.findOne({ identifier, purpose });

  if (!otpRecord) {
    return { valid: false, message: "OTP not found or expired" };
  }

  if (otpRecord.attempts >= MAX_ATTEMPTS) {
    await OTP.deleteOne({ _id: otpRecord._id });
    return { valid: false, message: "Maximum attempts exceeded. Please request a new OTP" };
  }

  const isMatch = await bcrypt.compare(plainOtp, otpRecord.otp);

  if (!isMatch) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    return { valid: false, message: "Invalid OTP" };
  }

  // Valid — delete the OTP
  await OTP.deleteOne({ _id: otpRecord._id });
  return { valid: true };
};

module.exports = { generateOTP, createOTP, verifyOTP };
