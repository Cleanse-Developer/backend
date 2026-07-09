const mongoose = require("mongoose");

const volumeTierSchema = new mongoose.Schema(
  {
    minQuantity: { type: Number, required: true, min: 1 },
    discountType: {
      type: String,
      enum: ["percentage", "fixed_per_item"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const buyConditionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["product", "category", "any"],
    },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
    minQuantity: { type: Number, min: 1 },
    minAmount: { type: Number, min: 0 },
  },
  { _id: false }
);

const getRewardSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "percentage_off",
        "fixed_off",
        "free",
        "fixed_price",
        "free_shipping",
        "discounted_shipping",
      ],
    },
    rewardScope: {
      type: String,
      enum: [
        "specific_products",
        "same_as_buy",
        "cheapest_in_cart",
        "most_expensive_in_cart",
      ],
    },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
    quantity: { type: Number, min: 1 },
    discountValue: { type: Number, min: 0 },
    maxDiscountAmount: { type: Number },
  },
  { _id: false }
);

const fixedPriceBundleSchema = new mongoose.Schema(
  {
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    quantities: [{ type: Number, min: 1 }],
    fixedPrice: { type: Number, min: 0 },
  },
  { _id: false }
);

const freeGiftSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    variantSize: { type: String },
    maxQuantity: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const shippingTierSchema = new mongoose.Schema(
  {
    discountType: {
      type: String,
      enum: ["percentage", "fixed_rate"],
    },
    discountValue: { type: Number, min: 0 },
  },
  { _id: false }
);

const specialCouponSchema = new mongoose.Schema(
  {
    // --- Identity ---
    code: {
      type: String,
      sparse: true,
      unique: true,
      uppercase: true,
      trim: true,
      default: null,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 500 },
    promotionType: {
      type: String,
      enum: [
        "bxgy",
        "volume_discount",
        "spend_threshold",
        "fixed_price_bundle",
        "free_gift",
        "tiered_shipping",
      ],
      required: true,
    },
    applicationMethod: {
      type: String,
      enum: ["code", "automatic"],
      required: true,
    },

    // --- Buy Conditions ---
    buyCondition: { type: buyConditionSchema, default: () => ({}) },

    // --- Get Reward (for bxgy, spend_threshold) ---
    getReward: { type: getRewardSchema, default: () => ({}) },

    // --- Volume Tiers (for volume_discount) ---
    volumeTiers: [volumeTierSchema],

    // --- Fixed Price Bundle (for fixed_price_bundle) ---
    fixedPriceBundle: { type: fixedPriceBundleSchema, default: () => ({}) },

    // --- Free Gift (for free_gift) ---
    freeGift: { type: freeGiftSchema, default: () => ({}) },

    // --- Shipping Tier (for tiered_shipping) ---
    shippingTier: { type: shippingTierSchema, default: () => ({}) },

    // --- Scheduling ---
    validFrom: { type: Date, default: Date.now },
    validTill: { type: Date, required: true },

    // --- Usage Limits ---
    usageLimit: { type: Number },
    usageCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 },
    usedBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        usedAt: { type: Date },
      },
    ],

    // --- Eligibility ---
    isFirstOrderOnly: { type: Boolean, default: false },
    minOrderValue: { type: Number, default: 0 },
    maxOrderValue: { type: Number },
    customerEligibility: {
      type: String,
      enum: ["all", "specific_customers", "customer_segments"],
      default: "all",
    },
    eligibleCustomerIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    ],
    eligibleTags: [{ type: String }],

    // --- Stacking Rules ---
    stackable: { type: Boolean, default: false },
    stackGroup: { type: String, trim: true },
    excludeWithCoupons: { type: Boolean, default: true },
    excludeWithOther: [
      { type: mongoose.Schema.Types.ObjectId, ref: "SpecialCoupon" },
    ],
    priority: { type: Number, default: 0 },

    // --- Limits on Discount ---
    maxDiscountPerOrder: { type: Number },

    // --- Status ---
    isActive: { type: Boolean, default: true },

    // --- Metadata ---
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, maxlength: 1000 },
    // External promoter that owns this code (null for regular promotions).
    promoter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promoter",
      default: null,
    },
  },
  { timestamps: true }
);

specialCouponSchema.index({ isActive: 1, validTill: 1 });
specialCouponSchema.index({ promoter: 1 }, { sparse: true });
specialCouponSchema.index({ applicationMethod: 1, isActive: 1, validFrom: 1, validTill: 1 });
specialCouponSchema.index({ code: 1 }, { sparse: true });
specialCouponSchema.index({ promotionType: 1 });
specialCouponSchema.index({ "buyCondition.productIds": 1 });
specialCouponSchema.index({ "buyCondition.categoryIds": 1 });

module.exports = mongoose.model("SpecialCoupon", specialCouponSchema);
