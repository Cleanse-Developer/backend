const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String },
    subject: {
      type: String,
      enum: ["order", "product", "return", "wholesale", "other"],
      default: "other",
    },
    message: { type: String, required: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ["new", "read", "replied", "closed"],
      default: "new",
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

contactSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Contact", contactSchema);
