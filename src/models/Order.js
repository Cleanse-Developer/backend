const mongoose = require("mongoose");
const {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} = require("../utils/constants");

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true, min: 1 },
        selectedSize: { type: String },
        image: { type: String },
      },
    ],
    shippingAddress: {
      fullName: { type: String, required: true },
      email: { type: String },
      phone: { type: String, required: true },
      address1: { type: String, required: true },
      address2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      country: { type: String, default: "India" },
    },
    billingAddress: {
      fullName: { type: String },
      address1: { type: String },
      address2: { type: String },
      city: { type: String },
      state: { type: String },
      pincode: { type: String },
      country: { type: String },
    },
    billingSameAsShipping: { type: Boolean, default: true },
    payment: {
      method: { type: String, enum: PAYMENT_METHODS, required: true },
      razorpayOrderId: { type: String },
      razorpayPaymentId: { type: String },
      status: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
    },
    pricing: {
      subtotal: { type: Number, required: true },
      tierDiscount: { type: Number, default: 0 },
      tierPercent: { type: Number, default: 0 },
      tierLabel: { type: String },
      couponDiscount: { type: Number, default: 0 },
      couponCode: { type: String },
      shippingCost: { type: Number, default: 0 },
      giftWrapCost: { type: Number, default: 0 },
      total: { type: Number, required: true },
    },
    giftWrap: { type: Boolean, default: false },
    giftMessage: { type: String, maxlength: 200 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
    shipping: {
      shiprocketOrderId: { type: String },
      awbNumber: { type: String },
      courierName: { type: String },
      trackingUrl: { type: String },
      estimatedDelivery: { type: Date },
    },
    returnRequest: {
      requested: { type: Boolean, default: false },
      reason: { type: String },
      status: {
        type: String,
        enum: ["none", "requested", "approved", "rejected", "completed"],
        default: "none",
      },
      requestedAt: { type: Date },
    },
    adminNotes: [
      {
        note: { type: String },
        addedBy: { type: mongoose.Schema.Types.ObjectId },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    loyaltyPointsEarned: { type: Number, default: 0 },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ "payment.status": 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
