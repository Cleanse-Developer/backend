const SpinWheelPrize = require("../models/SpinWheelPrize");

const prizes = [
  { label: "10% OFF",   value: "10off",    weight: 25, discountType: "percentage",    discountValue: 10,  color: "#4F2C22", textColor: "#F0EDE8" },
  { label: "FREE SHIP", value: "freeship", weight: 20, discountType: "free_shipping", discountValue: 0,   color: "#F0EDE8", textColor: "#4F2C22" },
  { label: "5% OFF",    value: "5off",     weight: 30, discountType: "percentage",    discountValue: 5,   color: "#4F2C22", textColor: "#F0EDE8" },
  { label: "TRY AGAIN", value: "tryagain", weight: 15, discountType: null,            discountValue: 0,   color: "#F0EDE8", textColor: "#4F2C22" },
  { label: "15% OFF",   value: "15off",    weight: 5,  discountType: "percentage",    discountValue: 15,  color: "#4F2C22", textColor: "#F0EDE8" },
  { label: "FREE GIFT", value: "sample",   weight: 5,  discountType: "fixed",         discountValue: 200, color: "#F0EDE8", textColor: "#4F2C22" },
];

const seedSpinWheelPrizes = async () => {
  const count = await SpinWheelPrize.countDocuments();
  if (count > 0) {
    console.log(`  ✓ Spin wheel prizes already seeded (${count} found)`);
    return;
  }

  await SpinWheelPrize.insertMany(prizes);
  console.log(`  ✓ ${prizes.length} spin wheel prizes seeded`);
};

module.exports = seedSpinWheelPrizes;
