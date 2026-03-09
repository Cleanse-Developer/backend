const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { ROLES } = require("../utils/constants");

const seedAdmin = async () => {
  const existing = await User.findOne({ email: "admin@cleanse.com" });
  if (existing) {
    console.log("  ✓ Admin user already exists");
    return;
  }

  const hashedPassword = await bcrypt.hash("Admin@123", 12);

  await User.create({
    fullName: "Cleanse Admin",
    email: "admin@cleanse.com",
    phone: "+919999999999",
    password: hashedPassword,
    role: ROLES.ADMIN,
    status: "active",
    loyaltyPoints: 0,
  });

  console.log("  ✓ Admin user seeded (admin@cleanse.com / Admin@123)");
};

module.exports = seedAdmin;
