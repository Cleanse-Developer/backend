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
        isFreeGift: { type: Boolean, default: false },
      },
    ],
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
    paymentSession: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentSession" },
    payment: {
      method: { type: String, enum: PAYMENT_METHODS, required: true },
      razorpayOrderId: { type: String },
      razorpayPaymentId: { type: String },
      status: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
      refunds: [
        {
          refundId: { type: String },
          amount: { type: Number },
          reason: { type: String },
          status: {
            type: String,
            enum: ["initiated", "processed", "failed"],
          },
          initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
    pricing: {
      subtotal: { type: Number, required: true },
      bundleDiscounts: [
        {
          bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle" },
          bundleName: { type: String },
          discountType: { type: String, enum: ["percentage", "fixed"] },
          discountValue: { type: Number },
          productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
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
          specialCouponId: { type: mongoose.Schema.Types.ObjectId, ref: "SpecialCoupon" },
          promotionType: { type: String },
          title: { type: String },
          code: { type: String },
          discountAmount: { type: Number },
          freeItems: [
            {
              productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
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
    },
    giftWrap: { type: Boolean, default: false },
    giftMessage: { type: String, maxlength: 200 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
    // Lifecycle milestone timestamps (powers the order timeline). Previously set
    // in code but absent from the schema → silently dropped by strict mode.
    confirmedAt: { type: Date },
    pickupBookedAt: { type: Date },
    shippedAt: { type: Date }, // set when courier picks up (webhook)
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    shipping: {
      shiprocketOrderId: { type: String },
      shipmentId: { type: String },
      awbNumber: { type: String },
      courierName: { type: String },
      trackingUrl: { type: String },
      labelUrl: { type: String },
      manifestUrl: { type: String },
      pickupScheduledDate: { type: Date },
      estimatedDelivery: { type: Date },
      lastTrackingStatus: { type: String },
      lastTrackingStatusId: { type: Number },
      lastWebhookAt: { type: Date },
      ndrAttempts: { type: Number, default: 0 },
      isRTO: { type: Boolean, default: false },
      returnShipment: {
        shiprocketOrderId: { type: String },
        shipmentId: { type: String },
        awbNumber: { type: String },
        courierName: { type: String },
        trackingUrl: { type: String },
      },
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
    // Unified activity log (rendered as the "Activity" feed). Every meaningful
    // event from any participant is appended here with attribution.
    // actor: who caused it — "customer" | "system" | "courier" | "admin".
    // isOverride: an admin manually did something that normally happens
    // automatically. Legacy entries (no actor) render as "admin".
    adminNotes: [
      {
        note: { type: String },
        actor: {
          type: String,
          enum: ["customer", "system", "courier", "admin"],
          default: "admin",
        },
        event: { type: String },
        isOverride: { type: Boolean, default: false },
        addedBy: { type: mongoose.Schema.Types.ObjectId },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    contactEmail: { type: String },
    contactPhone: { type: String },
    // Estimate computed at order creation (what the order WILL earn).
    loyaltyPointsEarned: { type: Number, default: 0 },
    // Points ACTUALLY credited to the buyer for this order (set when they're
    // awarded — after payment / COD approval, not at creation). This, not the
    // estimate above, is what a cancel/refund reverses, so an order cancelled
    // before its points were ever credited can't claw back points the buyer
    // never received. Zeroed once reversed, so a reversal can't run twice.
    loyaltyPointsAwarded: { type: Number, default: 0 },
    // External-promoter attribution. Set at order creation when the order used a
    // promoter-owned coupon code (via="code") or came through a promoter link
    // (via="link"). Drives commission accrual/reversal. Absent for organic orders.
    // The snapshot fields are frozen at creation so later promoter edits never
    // rewrite historical commission.
    attribution: {
      promoter: { type: mongoose.Schema.Types.ObjectId, ref: "Promoter" },
      via: { type: String, enum: ["code", "link"] },
      code: { type: String },
      link: { type: mongoose.Schema.Types.ObjectId, ref: "PromoterLink" },
      commissionSnapshot: {
        type: { type: String },
        rate: { type: Number },
        basis: { type: String },
      },
      basisAmount: { type: Number },
      commissionAmount: { type: Number },
      status: {
        type: String,
        enum: ["pending", "confirmed", "reversed"],
        default: "pending",
      },
    },
    // COD WhatsApp approval tracking. Present only on held COD orders.
    // "awaiting" → confirmation sent, order on hold (no Shiprocket/loyalty yet);
    // "confirmed" / "cancelled" set when the customer responds (webhook/admin).
    codConfirmation: {
      wamid: { type: String },
      status: { type: String, enum: ["awaiting", "confirmed", "cancelled"] },
      sentAt: { type: Date },
      respondedAt: { type: Date },
      error: { type: String },
    },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ "attribution.promoter": 1, createdAt: -1 }, { sparse: true });
orderSchema.index({ "payment.status": 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
