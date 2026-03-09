const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    identifier: { type: String, required: true }, // email or phone
    otp: { type: String, required: true }, // hashed
    purpose: {
      type: String,
      enum: ["login", "register", "reset"],
      default: "login",
    },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

otpSchema.index({ identifier: 1, purpose: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-delete

module.exports = mongoose.model("OTP", otpSchema);
