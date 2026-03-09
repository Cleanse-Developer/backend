const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: { type: Number, required: true, min: 1, default: 1 },
        selectedSize: { type: String },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    giftWrap: { type: Boolean, default: false },
    giftMessage: { type: String, maxlength: 200 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Cart", cartSchema);
