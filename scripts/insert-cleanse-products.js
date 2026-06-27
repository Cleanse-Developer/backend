/**
 * One-off: insert 7 cleaned "Cleanse Ayurveda" products as DRAFTS (isActive:false).
 * Data source: cleaned bulk-upload sheet, exported to products_clean.json.
 * - Resolves category by tag (3 root categories).
 * - All 5 tabHighlights tabs, random icons from per-tab valid pools.
 * - Slug collision -> mint new slug (-2, -3...). SKU collision -> suffix to stay globally unique.
 * Run: node backend/scripts/insert-cleanse-products.js [path-to-products_clean.json]
 */
require("dotenv").config();
const fs = require("fs");
const mongoose = require("mongoose");
const Product = require("../src/models/Product");
const Category = require("../src/models/Category");

const DATA_PATH =
  process.argv[2] ||
  "C:/Users/Yatharth/AppData/Local/Temp/claude/g--AIB-cleanse/f56e1092-772e-415a-a4e9-4ff8561109b8/scratchpad/products_clean.json";

// Valid icon names per tab (from admin tab-highlights-editor ICON_CATALOG + frontend ValueIcon map)
const ICON_POOLS = {
  ingredients: ["plant", "dropper", "leaf", "saffron", "lotus", "noparaben", "chemical"],
  values: ["plant", "dropper", "leaf", "paw", "chemical", "noparaben", "lotus"],
  howToUse: ["wash", "drops", "hands", "massage", "moon", "repeat"],
  shippingInfo: ["truck", "clock", "express", "globe", "returnbox", "shield"],
  policies: ["certificate", "calendar", "sun", "test", "external", "check"],
};

// Generic brand-default labels for tabs the sheet has no data for
const VALUES_LABELS = ["100% Natural", "Plant Based", "Cruelty Free", "No Parabens", "No Sulfates", "Ayurvedic"];
const SHIPPING_LABELS = ["Free Shipping", "3-5 Business Days", "Express Available", "Ships Pan-India", "7-Day Returns", "Secure Packaging"];
const POLICY_LABELS = ["Patch Test First", "External Use Only", "Store Cool & Dry", "24 Month Shelf Life", "Certified Safe", "Quality Assured"];

// Pick `labels.length` distinct icons at random from a pool (cycles if pool too small)
function assignIcons(pool, labels) {
  const avail = [...pool];
  return labels.slice(0, 6).map((label) => {
    if (avail.length === 0) avail.push(...pool);
    const i = Math.floor(Math.random() * avail.length);
    const icon = avail.splice(i, 1)[0];
    return { icon, label };
  });
}

// Turn free-text howToUse into <=6 short step labels
function parseSteps(text) {
  return String(text)
    .split(/[\n,.]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((s) => {
      const words = s.split(/\s+/).slice(0, 4).join(" ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    });
}

function buildTabHighlights(p) {
  const ing = assignIcons(ICON_POOLS.ingredients, p.keyIngredients.length ? p.keyIngredients : ["Natural Actives"]);
  const steps = parseSteps(p.howToUse);
  return {
    ingredients: ing,
    values: assignIcons(ICON_POOLS.values, VALUES_LABELS),
    howToUse: assignIcons(ICON_POOLS.howToUse, steps.length ? steps : ["Apply", "Massage", "Rinse"]),
    shippingInfo: assignIcons(ICON_POOLS.shippingInfo, SHIPPING_LABELS),
    policies: assignIcons(ICON_POOLS.policies, POLICY_LABELS),
  };
}

async function uniqueSlug(base) {
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Product.findOne({ slug }).lean()) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

async function uniqueSku(base) {
  let sku = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Product.findOne({ "sizes.sku": sku }).lean()) {
    n += 1;
    sku = `${base}-${n}`;
  }
  return sku;
}

async function run() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected:", mongoose.connection.host);

  const cats = await Category.find({}).lean();
  const catMap = {};
  for (const c of cats) catMap[c.name] = c._id;
  for (const t of ["Face Care", "Hair Care", "Body Care"]) {
    if (!catMap[t]) throw new Error(`Missing category: ${t}`);
  }

  const summary = [];
  for (const p of raw) {
    const slug = await uniqueSlug(p.slug);
    const sku = await uniqueSku(p.sku);

    const images = [
      { url: p.primaryImageUrl, alt: p.name, isPrimary: true },
      ...p.additionalImageUrls.map((u) => ({ url: u, alt: p.name, isPrimary: false })),
    ].filter((img) => img.url);

    const price = Number(p.salePrice);
    const compareAtPrice = p.mrp ? Number(p.mrp) : undefined;

    const doc = new Product({
      name: p.name,
      slug,
      description: p.description,
      shortDescription: p.shortDescription,
      benefits: p.benefits,
      skinType: p.skinType,
      concerns: p.concerns,
      price,
      compareAtPrice,
      tag: p.tag,
      category: catMap[p.tag],
      sizes: [{ label: p.variantName, price, sku, stock: Number(p.stock) || 0 }],
      images,
      ingredients: p.ingredients,
      howToUse: p.howToUse,
      tabHighlights: buildTabHighlights(p),
      seo: {
        metaTitle: p.seoTitle || undefined,
        metaDescription: p.seoDescription || undefined,
        keywords: p.seoKeywords,
      },
      isActive: false, // DRAFT
      isFeatured: false,
    });

    // eslint-disable-next-line no-await-in-loop
    await doc.save();
    summary.push({ name: p.name, slug, sku, price, draft: !doc.isActive });
    console.log(`  + ${p.name}  (slug=${slug}, sku=${sku}, Rs.${price}, draft)`);
  }

  console.log(`\nInserted ${summary.length} products as drafts.`);
  console.table(summary);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
