require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");

const seedCategories = require("./categories.seed");
const seedAdmin = require("./admin.seed");
const seedProducts = require("./products.seed");
const seedBlogs = require("./blogs.seed");
const seedCoupons = require("./coupons.seed");
const seedSettings = require("./settings.seed");

const isReset = process.argv.includes("--reset");

const run = async () => {
  try {
    await connectDB();
    console.log("\nSeeding database...\n");

    if (isReset) {
      console.log("  Dropping all collections...");
      const collections = await mongoose.connection.db.listCollections().toArray();
      for (const col of collections) {
        await mongoose.connection.db.dropCollection(col.name);
      }
      console.log("  ✓ All collections dropped\n");
    }

    // Order matters: categories before products, authors before blogs
    await seedCategories();
    await seedAdmin();
    await seedProducts();
    await seedBlogs();
    await seedCoupons();
    await seedSettings();

    console.log("\nSeeding complete!\n");
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
};

run();
