const Settings = require("../models/Settings");

const settings = [
  {
    key: "discount_tiers",
    value: [
      { threshold: 3500, percent: 15, label: "15% OFF" },
      { threshold: 2000, percent: 10, label: "10% OFF" },
      { threshold: 500, percent: 5, label: "5% OFF" },
    ],
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
    value: 0.1, // 1 point per ₹10
  },
  {
    key: "referral_reward",
    value: 200,
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
  console.log(`  ✓ ${settings.length} settings seeded`);
};

module.exports = seedSettings;
