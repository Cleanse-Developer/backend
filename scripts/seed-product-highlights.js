/**
 * Seed product tabHighlights via admin API routes.
 * Usage: node backend/scripts/seed-product-highlights.js
 */

const BASE_URL = process.env.API_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = "admin@cleanse.com";
const ADMIN_PASSWORD = "Admin@123";

// Per-product highlight overrides keyed by slug.
// Products not listed here get sensible defaults based on their tag.
const PRODUCT_HIGHLIGHTS = {
  "kumkumadi-night-elixir": {
    ingredients: [
      { icon: "saffron", label: "Kashmiri Saffron" },
      { icon: "leaf", label: "Organic Herbs" },
      { icon: "dropper", label: "Cold Pressed Oils" },
      { icon: "noparaben", label: "No Parabens" },
      { icon: "chemical", label: "No Sulfates" },
      { icon: "plant", label: "100% Natural" },
    ],
    values: [
      { icon: "plant", label: "Plant Based" },
      { icon: "dropper", label: "No Artificial Color" },
      { icon: "leaf", label: "Sustainably Sourced" },
      { icon: "paw", label: "Cruelty Free" },
      { icon: "chemical", label: "No Synthetic Chemicals" },
      { icon: "lotus", label: "100% Ayurvedic" },
    ],
    howToUse: [
      { icon: "wash", label: "Cleanse Face" },
      { icon: "drops", label: "3-4 Drops" },
      { icon: "hands", label: "Warm in Palms" },
      { icon: "massage", label: "Massage Upward" },
      { icon: "moon", label: "Leave Overnight" },
      { icon: "repeat", label: "Use Nightly" },
    ],
    shippingInfo: [
      { icon: "truck", label: "Free Shipping" },
      { icon: "clock", label: "3-5 Business Days" },
      { icon: "express", label: "Express Delivery" },
      { icon: "globe", label: "Ships Worldwide" },
      { icon: "returnbox", label: "7-Day Returns" },
      { icon: "shield", label: "Damage Protection" },
    ],
    policies: [
      { icon: "certificate", label: "Certified Safe" },
      { icon: "calendar", label: "24 Month Shelf Life" },
      { icon: "sun", label: "Store Cool & Dry" },
      { icon: "test", label: "Patch Test First" },
      { icon: "external", label: "External Use Only" },
      { icon: "check", label: "Quality Assured" },
    ],
  },
};

// Defaults by product tag
const TAG_DEFAULTS = {
  "Face Care": {
    ingredients: [
      { icon: "saffron", label: "Kashmiri Saffron" },
      { icon: "leaf", label: "Organic Herbs" },
      { icon: "dropper", label: "Cold Pressed Oils" },
      { icon: "noparaben", label: "No Parabens" },
      { icon: "chemical", label: "No Sulfates" },
      { icon: "plant", label: "100% Natural" },
    ],
    values: [
      { icon: "plant", label: "Plant Based" },
      { icon: "dropper", label: "No Artificial Color" },
      { icon: "leaf", label: "Sustainably Sourced" },
      { icon: "paw", label: "Cruelty Free" },
      { icon: "chemical", label: "No Synthetic Chemicals" },
      { icon: "lotus", label: "100% Ayurvedic" },
    ],
    howToUse: [
      { icon: "wash", label: "Cleanse Face" },
      { icon: "drops", label: "3-4 Drops" },
      { icon: "hands", label: "Warm in Palms" },
      { icon: "massage", label: "Massage Upward" },
      { icon: "moon", label: "Leave Overnight" },
      { icon: "repeat", label: "Use Nightly" },
    ],
    shippingInfo: [
      { icon: "truck", label: "Free Shipping" },
      { icon: "clock", label: "3-5 Business Days" },
      { icon: "express", label: "Express Delivery" },
      { icon: "globe", label: "Ships Worldwide" },
      { icon: "returnbox", label: "7-Day Returns" },
      { icon: "shield", label: "Damage Protection" },
    ],
    policies: [
      { icon: "certificate", label: "Certified Safe" },
      { icon: "calendar", label: "24 Month Shelf Life" },
      { icon: "sun", label: "Store Cool & Dry" },
      { icon: "test", label: "Patch Test First" },
      { icon: "external", label: "External Use Only" },
      { icon: "check", label: "Quality Assured" },
    ],
  },
  "Hair Care": {
    ingredients: [
      { icon: "leaf", label: "Bhringraj Extract" },
      { icon: "plant", label: "Amla Oil" },
      { icon: "saffron", label: "Brahmi" },
      { icon: "noparaben", label: "No Parabens" },
      { icon: "chemical", label: "No Sulfates" },
      { icon: "lotus", label: "100% Ayurvedic" },
    ],
    values: [
      { icon: "plant", label: "Plant Based" },
      { icon: "dropper", label: "No Artificial Color" },
      { icon: "leaf", label: "Sustainably Sourced" },
      { icon: "paw", label: "Cruelty Free" },
      { icon: "chemical", label: "No Synthetic Chemicals" },
      { icon: "lotus", label: "100% Ayurvedic" },
    ],
    howToUse: [
      { icon: "drops", label: "Apply to Scalp" },
      { icon: "massage", label: "Massage Gently" },
      { icon: "clock", label: "Leave 30 Min" },
      { icon: "wash", label: "Wash Off" },
      { icon: "repeat", label: "Use Weekly" },
      { icon: "moon", label: "Best at Night" },
    ],
    shippingInfo: [
      { icon: "truck", label: "Free Shipping" },
      { icon: "clock", label: "3-5 Business Days" },
      { icon: "express", label: "Express Delivery" },
      { icon: "globe", label: "Ships Worldwide" },
      { icon: "returnbox", label: "7-Day Returns" },
      { icon: "shield", label: "Damage Protection" },
    ],
    policies: [
      { icon: "certificate", label: "Certified Safe" },
      { icon: "calendar", label: "24 Month Shelf Life" },
      { icon: "sun", label: "Store Cool & Dry" },
      { icon: "test", label: "Patch Test First" },
      { icon: "external", label: "External Use Only" },
      { icon: "check", label: "Quality Assured" },
    ],
  },
  "Body Care": {
    ingredients: [
      { icon: "plant", label: "Natural Extracts" },
      { icon: "leaf", label: "Essential Oils" },
      { icon: "lotus", label: "Ayurvedic Herbs" },
      { icon: "noparaben", label: "No Parabens" },
      { icon: "chemical", label: "No Sulfates" },
      { icon: "dropper", label: "Cold Pressed" },
    ],
    values: [
      { icon: "plant", label: "Plant Based" },
      { icon: "dropper", label: "No Artificial Color" },
      { icon: "leaf", label: "Sustainably Sourced" },
      { icon: "paw", label: "Cruelty Free" },
      { icon: "chemical", label: "No Synthetic Chemicals" },
      { icon: "lotus", label: "100% Ayurvedic" },
    ],
    howToUse: [
      { icon: "wash", label: "Cleanse Skin" },
      { icon: "drops", label: "Take Amount" },
      { icon: "hands", label: "Warm in Palms" },
      { icon: "massage", label: "Apply Evenly" },
      { icon: "repeat", label: "Use Daily" },
      { icon: "sun", label: "Apply SPF After" },
    ],
    shippingInfo: [
      { icon: "truck", label: "Free Shipping" },
      { icon: "clock", label: "3-5 Business Days" },
      { icon: "express", label: "Express Delivery" },
      { icon: "globe", label: "Ships Worldwide" },
      { icon: "returnbox", label: "7-Day Returns" },
      { icon: "shield", label: "Damage Protection" },
    ],
    policies: [
      { icon: "certificate", label: "Certified Safe" },
      { icon: "calendar", label: "24 Month Shelf Life" },
      { icon: "sun", label: "Store Cool & Dry" },
      { icon: "test", label: "Patch Test First" },
      { icon: "external", label: "External Use Only" },
      { icon: "check", label: "Quality Assured" },
    ],
  },
};

async function main() {
  // 1. Login
  console.log("Logging in as admin...");
  const loginRes = await fetch(`${BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error("Login failed:", loginRes.status);
    process.exit(1);
  }
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.accessToken;
  console.log("  ✓ Logged in\n");

  // 2. Fetch all products
  console.log("Fetching products...");
  const prodRes = await fetch(`${BASE_URL}/admin/products?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const prodData = await prodRes.json();
  const products = prodData.data?.products || [];
  console.log(`  ✓ Found ${products.length} products\n`);

  // 3. Patch each product with highlights
  let updated = 0;
  for (const product of products) {
    const slug = product.slug;
    const tag = product.tag;

    // Use product-specific overrides if available, else tag defaults
    const highlights =
      PRODUCT_HIGHLIGHTS[slug] || TAG_DEFAULTS[tag] || TAG_DEFAULTS["Face Care"];

    process.stdout.write(`  Patching "${product.name}" (${tag})...`);

    const patchRes = await fetch(`${BASE_URL}/admin/products/${product._id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tabHighlights: highlights }),
    });

    if (!patchRes.ok) {
      const text = await patchRes.text();
      console.log(` ✗ (${patchRes.status}): ${text}`);
      continue;
    }
    console.log(" ✓");
    updated++;
  }

  console.log(`\n✅ Done! Updated ${updated}/${products.length} products with tab highlights.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
