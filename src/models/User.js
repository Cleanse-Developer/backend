const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, select: false },
    dateOfBirth: { type: Date },
    role: {
      type: String,
      enum: ["customer", "admin", "manager", "support"],
      default: "customer",
    },
    loyaltyPoints: { type: Number, default: 0 },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    preferences: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
      newsletter: { type: Boolean, default: true },
    },
    status: {
      type: String,
      enum: ["active", "suspended", "deactivated"],
      default: "active",
    },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
