const Coupon = require("../models/Coupon");

const coupons = [
  {
    code: "CLEANSE20",
    description: "Get 20% off on your order",
    discountType: "percentage",
    discountValue: 20,
    minOrderValue: 500,
    maxDiscountAmount: 500,
    validFrom: new Date("2025-01-01"),
    validTill: new Date("2026-12-31"),
    usageLimit: 1000,
    perUserLimit: 3,
    isActive: true,
    isFirstOrderOnly: false,
  },
  {
    code: "FREESHIP",
    description: "Free shipping on any order",
    discountType: "free_shipping",
    discountValue: 0,
    minOrderValue: 0,
    validFrom: new Date("2025-01-01"),
    validTill: new Date("2026-12-31"),
    usageLimit: 500,
    perUserLimit: 2,
    isActive: true,
    isFirstOrderOnly: false,
  },
  {
    code: "NEWUSER10",
    description: "10% off on your first order",
    discountType: "percentage",
    discountValue: 10,
    minOrderValue: 300,
    maxDiscountAmount: 200,
    validFrom: new Date("2025-01-01"),
    validTill: new Date("2026-12-31"),
    usageLimit: 5000,
    perUserLimit: 1,
    isActive: true,
    isFirstOrderOnly: true,
  },
  {
    code: "RITUAL25",
    description: "Flat ₹250 off on orders above ₹2000",
    discountType: "fixed",
    discountValue: 250,
    minOrderValue: 2000,
    validFrom: new Date("2025-01-01"),
    validTill: new Date("2026-12-31"),
    usageLimit: 300,
    perUserLimit: 2,
    isActive: true,
    isFirstOrderOnly: false,
  },
];

const seedCoupons = async () => {
  for (const c of coupons) {
    await Coupon.findOneAndUpdate({ code: c.code }, c, { upsert: true });
  }
  console.log(`  ✓ ${coupons.length} coupons seeded`);
};

module.exports = seedCoupons;
