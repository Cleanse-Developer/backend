const Category = require("../models/Category");

const categories = [
  {
    name: "Face Care",
    slug: "face-care",
    description:
      "Ayurvedic face care products crafted with ancient herbs and botanicals for radiant, balanced skin.",
    sortOrder: 1,
    isActive: true,
  },
  {
    name: "Hair Care",
    slug: "hair-care",
    description:
      "Traditional herbal formulations to nourish, strengthen, and revitalize your hair naturally.",
    sortOrder: 2,
    isActive: true,
  },
  {
    name: "Body Care",
    slug: "body-care",
    description:
      "Luxurious body care rituals blending Ayurvedic wisdom with pure, natural ingredients.",
    sortOrder: 3,
    isActive: true,
  },
];

const seedCategories = async () => {
  for (const cat of categories) {
    await Category.findOneAndUpdate({ slug: cat.slug }, cat, { upsert: true });
  }
  console.log(`  ✓ ${categories.length} categories seeded`);
};

module.exports = seedCategories;
