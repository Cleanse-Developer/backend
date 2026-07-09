const mongoose = require("mongoose");
const { PAYMENT_SESSION_STATUSES } = require("../utils/constants");

const paymentSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Frozen cart snapshot at initiation time
    cart: {
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
          isFreeGift: { type: Boolean, default: false },
        },
      ],
    },

    // Frozen pricing breakdown (same shape as Order.pricing)
    pricing: {
      subtotal: { type: Number, required: true },
      bundleDiscounts: [
        {
          bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
          bundleName: { type: String },
          discountType: { type: String, enum: ["percentage", "fixed"] },
          discountValue: { type: Number },
          productIds: [
            { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
          ],
          bundleSubtotal: { type: Number },
          discountAmount: { type: Number },
        },
      ],
      bundleDiscountTotal: { type: Number, default: 0 },
      tierDiscount: { type: Number, default: 0 },
      tierPercent: { type: Number, default: 0 },
      tierLabel: { type: String },
      specialCouponDiscounts: [
        {
          specialCouponId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SpecialCoupon",
          },
          promotionType: { type: String },
          title: { type: String },
          code: { type: String },
          discountAmount: { type: Number },
          freeItems: [
            {
              productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
              },
              productName: { type: String },
              quantity: { type: Number },
              unitPrice: { type: Number, default: 0 },
            },
          ],
        },
      ],
      specialCouponDiscountTotal: { type: Number, default: 0 },
      couponDiscount: { type: Number, default: 0 },
      couponCode: { type: String },
      shippingCost: { type: Number, default: 0 },
      giftWrapCost: { type: Number, default: 0 },
      loyaltyDiscount: { type: Number, default: 0 },
      loyaltyPointsRedeemed: { type: Number, default: 0 },
      total: { type: Number, required: true },
      loyaltyPoints: { type: Number, default: 0 },
      freeGifts: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
          },
          productName: { type: String },
          productImage: { type: String },
          unitPrice: { type: Number, default: 0 },
          quantity: { type: Number, default: 1 },
          variantSize: { type: String },
        },
      ],
    },

    couponCode: { type: String, default: null },
    specialCouponCode: { type: String, default: null },
    // Frozen last-click promoter attribution (from the storefront's stored
    // cookie/localStorage). The webhook order-create path has no request cookie,
    // so this must be captured at checkout initiation and frozen here.
    affiliateRef: {
      slug: { type: String, default: null },
    },
    giftWrap: { type: Boolean, default: false },
    giftMessage: { type: String, maxlength: 200 },

    shippingAddress: {
      fullName: { type: String, required: true },
      email: { type: String },
      phone: { type: String, required: true },
      countryCode: { type: String, default: "+91" },
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

    razorpayOrderId: { type: String },
    amountInPaise: { type: Number, required: true },

    status: {
      type: String,
      enum: PAYMENT_SESSION_STATUSES,
      default: "pending",
    },
    idempotencyKey: { type: String },

    stockReservations: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        sizeLabel: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],

    agendaJobId: { type: String },
    expiresAt: { type: Date },
    completedAt: { type: Date },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  },
  { timestamps: true }
);

paymentSessionSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
paymentSessionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
paymentSessionSchema.index({ user: 1, status: 1 });
paymentSessionSchema.index({ expiresAt: 1 });
paymentSessionSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("PaymentSession", paymentSessionSchema);
