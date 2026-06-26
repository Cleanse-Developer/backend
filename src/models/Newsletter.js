const mongoose = require("mongoose");
const crypto = require("crypto");

const newsletterSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    source: {
      type: String,
      enum: ["popup", "footer", "spin_wheel", "checkout"],
      default: "popup",
    },
    isActive: { type: Boolean, default: true },
    couponCode: { type: String, default: null },
    unsubscribeToken: {
      type: String,
      unique: true,
      sparse: true,
      default: () => crypto.randomBytes(32).toString("hex"),
    },
    unsubscribedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Newsletter", newsletterSchema);
