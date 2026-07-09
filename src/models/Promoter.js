const mongoose = require("mongoose");

// External promoter / affiliate / influencer. Created by an admin (NOT a website
// customer). Owns one or more Coupon/SpecialCoupon codes (via the `promoter` ref
// on those docs) and PromoterLinks. Earns commission on attributed orders, tracked
// in the CommissionLedger; settled (bookkeeping only) via Settlement.
const promoterSchema = new mongoose.Schema(
  {
    // Admin-facing handle (e.g. "RIYA"). This is NOT the coupon a customer types —
    // customer codes are Coupon/SpecialCoupon docs bound to this promoter.
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["active", "paused", "archived"],
      default: "active",
    },

    contact: {
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true },
      countryCode: { type: String, default: "+91" },
      instagram: { type: String, trim: true },
      youtube: { type: String, trim: true },
      website: { type: String, trim: true },
    },
    channel: {
      type: String,
      enum: ["instagram", "youtube", "tiktok", "blog", "whatsapp", "other"],
      default: "other",
    },
    // Self-reported audience size — informational only.
    audienceSize: { type: Number, default: 0 },

    commission: {
      type: {
        type: String,
        enum: ["percentage", "fixed_per_order"],
        default: "percentage",
      },
      // Percent (0-100) when type=percentage, else flat ₹ per attributed order.
      rate: { type: Number, default: 0, min: 0 },
      // No commission when the basis amount is below this.
      minOrderValue: { type: Number, default: 0 },
    },

    // Bookkeeping only — no real payout is executed against these.
    payout: {
      method: {
        type: String,
        enum: ["bank", "upi", "paypal", "manual"],
        default: "manual",
      },
      bankName: { type: String, trim: true },
      accountName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true },
      upiId: { type: String, trim: true },
      panNumber: { type: String, trim: true },
    },

    // If the promoter also has a customer account, link it here so we can block
    // self-referral (buying with their own code). Optional.
    linkedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Denormalized cache. Source of truth is the CommissionLedger — reporting and
    // settlement recompute from the ledger; these are for fast list/detail reads.
    totals: {
      totalOrders: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 }, // sum of attributed basisAmount
      totalEarned: { type: Number, default: 0 }, // lifetime commission earned
      totalApproved: { type: Number, default: 0 },
      totalSettled: { type: Number, default: 0 },
      totalPending: { type: Number, default: 0 }, // earned - reversed - settled
      totalClicks: { type: Number, default: 0 },
      totalVisitors: { type: Number, default: 0 },
      lastOrderAt: { type: Date },
    },

    notes: { type: String, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

promoterSchema.index({ status: 1 });
promoterSchema.index({ "contact.email": 1 }, { sparse: true });

module.exports = mongoose.model("Promoter", promoterSchema);
