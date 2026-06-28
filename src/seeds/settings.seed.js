const Settings = require("../models/Settings");

const settings = [
  {
    // Admin-managed cart tier discounts (read by pricing.service getDiscountTierConfig).
    // `percent` tiers = % off subtotal; one `free_shipping` tier marks the
    // free-shipping threshold. enabled:false turns the whole feature off.
    key: "discount_tier_config",
    value: {
      enabled: true,
      tiers: [
        { threshold: 500, type: "percent", percent: 5, label: "5% OFF" },
        { threshold: 1200, type: "free_shipping", label: "Free Shipping" },
        { threshold: 2000, type: "percent", percent: 10, label: "10% OFF" },
        { threshold: 3500, type: "percent", percent: 15, label: "15% OFF" },
      ],
    },
  },
  {
    key: "shipping_free_threshold",
    value: 1200,
  },
  {
    key: "shipping_standard_rate",
    value: 99,
  },
  {
    key: "gift_wrap_cost",
    value: 99,
  },
  {
    key: "loyalty_rate",
    value: 0.1, // 1 point per ₹10 (legacy, see loyalty_config)
  },
  {
    key: "loyalty_config",
    value: {
      enabled: true,
      earnRatePerRupee: 0.1, // 1 point per ₹10
      redeemRatePerPoint: 1, // 1 point = ₹1
      minRedemptionPoints: 100,
      maxPercentOfOrder: 50, // can pay up to 50% of subtotal with points
      expiryDays: 365, // 0 = no expiry
      showInProfile: true,
    },
  },
  {
    key: "referral_reward",
    value: 200, // legacy, see referral_config
  },
  {
    key: "referral_config",
    value: {
      enabled: true,
      rewardMode: "loyalty_points_referrer", // loyalty_points_referrer | loyalty_points_both | coupon_referrer | coupon_both
      referrerRewardValue: 200,
      refereeRewardValue: 100,
      referrerCouponDiscountType: "fixed", // fixed | percentage
      refereeCouponDiscountType: "fixed",
      couponValidityDays: 30,
      qualifyingOrderMinValue: 0,
      codePrefix: "CLEANSE-",
    },
  },
  {
    key: "site_name",
    value: "Cleanse Ayurveda",
  },
  {
    key: "support_email",
    value: "support@cleanseayurveda.com",
  },
  {
    key: "support_phone",
    value: "+911234567890",
  },
  {
    key: "max_cart_quantity",
    value: 10,
  },
];

const seedSettings = async () => {
  for (const s of settings) {
    await Settings.findOneAndUpdate({ key: s.key }, s, { upsert: true });
  }
  // Remove legacy/orphaned tier keys replaced by discount_tier_config
  await Settings.deleteMany({ key: { $in: ["discount_tiers", "DISCOUNT_TIERS"] } });
  console.log(`  ✓ ${settings.length} settings seeded`);
};

module.exports = seedSettings;
