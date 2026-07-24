/*
 * One-time backfill: move the storefront's hardcoded per-product "listing
 * content" (previously in frontend productListingContent.js) into each Product's
 * new `listingContent` field, matched the same way the storefront matched it
 * (substring over name/slug/shortDescription).
 *
 * Idempotent + safe: only fills products whose listingContent is still empty, so
 * re-running never clobbers content edited later from the admin.
 *
 *   node scripts/seed-product-listing-content.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Product = require("../src/models/Product");

// Verbatim from frontend/src/app/unit/[slug]/productListingContent.js
const LISTINGS = [
  {
    match: ["oil control face wash"],
    title: "Cleanse Oil Control Face Wash for Oily & Acne-Prone Skin — 100ml",
    description:
      "Say goodbye to breakouts and oily skin with Cleanse Oil Control Face Wash — a scientifically formulated, plant-powered cleanser built for oily and acne-prone skin. Its 5.1% active botanical blend works in synergy to deeply cleanse, control sebum, calm redness, and help prevent future breakouts without stripping the skin.",
    tags: ["Oil Control", "Deep Pore Cleanse", "Acne Care", "pH-Balanced", "Non-Drying"],
    helps: ["Purifying", "Oil Balancing", "Soothing"],
    targets: ["Acne", "Blackheads", "Excess Oil"],
  },
  {
    match: ["hydrating face wash"],
    title: "Cleanse Ayurveda Hydrating Face Wash for Dry & Dull Skin — 100ml",
    description:
      "Reveal your skin's natural radiance with Cleanse Ayurveda Hydrating Face Wash — a dual-action brightening and hydrating cleanser with a 31.1% active botanical blend. Aloe Vera and Cica support deep hydration and the skin barrier, while Natural AHA, Lemongrass, and Ginger gently smooth and brighten dull-looking skin.",
    tags: ["Deep Hydration", "Bright Skin", "Gentle AHA", "Barrier Care", "All Skin Types"],
    helps: ["Hydrating", "Brightening", "Smoothing"],
    targets: ["Dryness", "Dull Skin", "Rough Texture"],
  },
  {
    match: ["oil control shampoo", "dandruff care shampoo", "dandruff shampoo"],
    title: "Cleanse Ayurveda Dandruff Care Oil Control Shampoo — 250ml",
    description:
      "Say goodbye to flakes, itch, and oily scalp with Cleanse Ayurveda Oil Control Shampoo — a gentle yet powerful formula built around a 7.4% active botanical complex. Neem and Willow Bark target dandruff and scalp buildup, while Hibiscus and Aloe Vera nourish, soothe, and support a balanced scalp.",
    tags: ["Dandruff Care", "Oil Control", "Flake Reduction", "Itch Relief", "Sulphate-Free"],
    helps: ["Clarifying", "Scalp Balancing", "Soothing"],
    targets: ["Dandruff", "Oily Scalp", "Itching"],
  },
  {
    match: ["hydra smooth shampoo"],
    title: "Cleanse Ayurveda Hydra Smooth Shampoo for Dry & Damaged Hair — 250ml",
    description:
      "Restore dry, damaged, and frizz-prone hair with Cleanse Ayurveda Hydra Smooth Shampoo. Its 6.6% active repair complex combines Hydrolyzed Keratin with Bhringraj, Amla, and Hibiscus to strengthen weak strands, improve smoothness, reduce breakage, and bring back healthy-looking shine.",
    tags: ["Damage Repair", "Frizz Control", "Hair Strength", "Smooth & Shine", "Colour-Safe"],
    helps: ["Repairing", "Smoothing", "Strengthening"],
    targets: ["Frizz", "Hair Damage", "Breakage"],
  },
  {
    match: ["exfoliating body wash", "exfoliation body wash"],
    title: "Cleanse Ayurveda Exfoliating Body Wash for Tan Removal & Bright Skin — 250ml",
    description:
      "Transform rough, dull, tanned skin into touchably smooth radiance with Cleanse Ayurveda Exfoliating Body Wash. A 6.1% active AHA + BHA complex gently removes dead skin and pore buildup, while Saffron, Amla, and Aloe Vera help brighten uneven tone and leave skin soft and comfortable.",
    tags: ["Bright Skin", "Tan Care", "AHA + BHA", "Smooth Texture", "All Skin Types"],
    helps: ["Exfoliating", "Brightening", "Smoothing"],
    targets: ["Body Tan", "Dark Patches", "Bumpy Skin"],
  },
  {
    match: ["face moisturizer", "face moisturiser", "brightening moisturizer", "brightening moisturiser"],
    title: "Cleanse Ayurveda Brightening Face Moisturizer for All Skin Types — 50g",
    description:
      "Reveal your skin's natural radiance with Cleanse Ayurveda Brightening Face Moisturizer — a lightweight formula built around a 4.1% active brightening complex. Saffron and Hibiscus target dullness, while Aloe Vera and Omega-3-rich Flaxseed Oil hydrate, support the skin barrier, and lock in moisture.",
    tags: ["Bright Skin", "Lightweight", "Non-Greasy", "Barrier Care", "All Skin Types"],
    helps: ["Moisturizing", "Brightening", "Barrier Support"],
    targets: ["Dark Spots", "Uneven Tone", "Dehydration"],
  },
  {
    match: ["kasvi", "hair growth oil", "hair oil"],
    title: "Kasvi Ayurvedic Hair Growth Oil for Hair Fall Control — 120ml",
    description:
      "Experience ancient Ayurveda backed by modern science with Kasvi Ayurvedic Hair Growth Oil — a clinically inspired formula for hair fall, thinning, and slow growth. Triphala, Bhringraj, Brahmi, Neem, and Karanja work together to nourish roots, support scalp health, reduce breakage, and promote stronger-looking hair.",
    tags: ["Hair Fall Control", "Root Strength", "Hair Growth", "Scalp Care", "All Hair Types"],
    helps: ["Nourishing", "Strengthening", "Growth Support"],
    targets: ["Hair Fall", "Weak Roots", "Thinning Hair"],
  },
];

const matchListing = (product) => {
  const haystack = [product.name, product.slug, product.shortDescription]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return LISTINGS.find((l) => l.match.some((needle) => haystack.includes(needle)));
};

const hasContent = (lc) =>
  !!(lc && (lc.title || lc.description || lc.tags?.length || lc.helps?.length || lc.targets?.length));

const run = async () => {
  await connectDB();
  const products = await Product.find({ isDeleted: { $ne: true } });
  let filled = 0, skipped = 0, unmatched = [];
  for (const p of products) {
    if (hasContent(p.listingContent)) { skipped++; continue; }
    const l = matchListing(p);
    if (!l) { unmatched.push(p.name); continue; }
    p.listingContent = { title: l.title, description: l.description, tags: l.tags, helps: l.helps, targets: l.targets };
    await p.save();
    filled++;
    console.log(`  ✓ ${p.name}  →  "${l.title.slice(0, 50)}…"  [${l.tags.length} tags]`);
  }
  console.log(`\nfilled ${filled}, skipped ${skipped} (already had content), unmatched ${unmatched.length}`);
  if (unmatched.length) console.log("  unmatched:", unmatched.join(" | "));
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => { console.error("Seed error:", e); process.exit(1); });
