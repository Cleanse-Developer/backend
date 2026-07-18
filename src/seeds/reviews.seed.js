const Product = require("../models/Product");
const User = require("../models/User");
const Review = require("../models/Review");

/*
 * Seeds glowing, believable reviews for every active product.
 *
 * Requirements this satisfies:
 *  - Every active product gets a DISTINCT averageRating in (4.5, 5.0].
 *  - Every active product gets a DISTINCT reviewCount.
 *  - All individual ratings are 4 or 5 (uniformly positive).
 *
 * Why averageRating is written directly instead of via the app's recalc:
 * recalculateProductStats() rounds the average to ONE decimal, which yields
 * only six possible values across 4.5–5.0 — not enough to keep 30 products
 * distinct. So real approved Review docs are created (the storefront review
 * list and reviewCount are genuine), and averageRating is then overwritten
 * with a distinct 2-decimal target. Each product's review ratings are composed
 * to average that target, so a future recalc (triggered by a real customer
 * review) lands within ~0.01 of the seeded value rather than jumping.
 *
 * Idempotent: fake reviewers live under the @cleanse-seed.local domain; their
 * reviews are cleared and rebuilt on every run, so it is safe to re-seed.
 */

const SEED_EMAIL_DOMAIN = "cleanse-seed.local";

// Distinct 2-decimal ratings, all > 4.5. One per active product (by index).
// prettier-ignore
const RATINGS = [
  4.97, 4.72, 4.88, 4.63, 4.91, 4.79, 4.68, 4.95, 4.6, 4.84,
  4.76, 4.99, 4.66, 4.82, 4.9, 4.71, 4.86, 4.64, 4.93, 4.77,
  4.69, 4.96, 4.61, 4.83, 4.74, 4.89, 4.67, 4.94, 4.78, 4.85,
];

// Distinct review counts, one per active product (by index). Max = 137, so the
// reviewer pool below must hold at least that many users.
// prettier-ignore
const COUNTS = [
  137, 42, 89, 63, 118, 51, 74, 103, 29, 96,
  58, 127, 47, 81, 112, 38, 92, 33, 121, 68,
  54, 131, 26, 84, 61, 108, 44, 124, 71, 99,
];

const FIRST_NAMES = [
  "Aarav", "Diya", "Vivaan", "Ananya", "Aditya", "Ishita", "Arjun", "Kavya",
  "Reyansh", "Saanvi", "Vihaan", "Aadhya", "Krishna", "Myra", "Sai", "Anika",
  "Dhruv", "Navya", "Kabir", "Riya", "Ayaan", "Prisha", "Rudra", "Aarohi",
  "Shaurya", "Anaya", "Atharv", "Siya", "Ved", "Pari", "Neha", "Rohan",
  "Meera", "Kunal", "Tara", "Nikhil", "Sneha", "Karan", "Pooja", "Rahul",
  "Divya", "Manish", "Isha", "Varun", "Sana", "Amit", "Nisha", "Yash",
];

const LAST_NAMES = [
  "Sharma", "Verma", "Iyer", "Nair", "Reddy", "Gupta", "Menon", "Rao",
  "Patel", "Singh", "Bose", "Chopra", "Kapoor", "Mehta", "Joshi", "Desai",
  "Pillai", "Banerjee", "Kulkarni", "Malhotra", "Sethi", "Ghosh", "Bhat",
  "Chauhan", "Saxena", "Deshpande", "Trivedi", "Shetty", "Agarwal", "Naidu",
];

const TITLES = [
  "Absolutely love it", "Exceeded my expectations", "A new staple",
  "Worth every rupee", "Gentle and effective", "Visible results",
  "My skin thanks me", "Repurchasing for sure", "Beautiful product",
  "Better than expected", "Highly recommend", "So glad I tried this",
  "Genuinely impressed", "Everything I hoped for", "Can't live without it",
  "Pure and honest", "Noticeable difference", "Feels luxurious",
  "Fast results", "Perfect for sensitive skin", "A little goes a long way",
  "Smells divine", "Consistent quality", "Five stars from me",
  "Ayurveda done right",
];

const BODIES = [
  "Started noticing a difference within a couple of weeks. The texture is lovely and it never irritates my skin.",
  "I was skeptical about ayurvedic products but this completely won me over. Gentle, effective, and smells natural.",
  "Been using it daily for over a month now. My skin feels calmer and more even-toned than it has in years.",
  "The quality is obvious from the first use. Absorbs quickly and doesn't leave any greasy residue.",
  "Exactly what my routine was missing. A small amount goes a long way, so the bottle lasts ages.",
  "My whole family uses this now. Nothing artificial, no harsh smell, just clean results.",
  "Ordered again before I even ran out. It has become a non-negotiable part of my mornings.",
  "Sensitive skin here and this caused zero reactions. If anything it calmed the redness I usually get.",
  "The scent is subtle and grounding, not overpowering at all. Feels like a little ritual every day.",
  "Genuinely impressed by how fast I saw results. Friends have started asking what I changed.",
  "Packaging is minimal and the product inside is even better. You can tell it's made with care.",
  "This replaced two other products in my routine. Simpler, cleaner, and my skin prefers it.",
  "Honestly the best I've tried in this category. Worth every rupee and then some.",
  "Light, effective and never sticky. Perfect for the humid weather where I live.",
  "I appreciate that the ingredients are recognisable and traditional. It works without the chemicals.",
  "Bought it on a whim and now it's a permanent fixture on my shelf. Wonderful stuff.",
  "Results were subtle at first but after a month the difference is undeniable. Deeply happy with it.",
  "Great for my whole face and it hasn't broken me out once. That alone earns five stars.",
  "The consistency is perfect and a little really does go a long way. Excellent value.",
  "Feels genuinely nourishing rather than just sitting on top of the skin. Will keep buying.",
];

// Deterministic full name for reviewer index n (no RNG so runs are reproducible).
const nameFor = (n) => {
  const first = FIRST_NAMES[n % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(n / FIRST_NAMES.length) % LAST_NAMES.length];
  return `${first} ${last}`;
};

const seedReviews = async () => {
  const products = await Product.find({ isActive: true }).sort({ createdAt: 1 });

  if (products.length === 0) {
    console.log("  ⚠ No active products — skipping review seed");
    return;
  }
  if (products.length > RATINGS.length) {
    throw new Error(
      `Review seed supports up to ${RATINGS.length} active products, found ${products.length}. Extend RATINGS/COUNTS.`
    );
  }

  // A product can never have more reviews than there are reviewers (unique
  // user+product index), so size the pool to the largest count actually used.
  const poolSize = Math.max(...COUNTS.slice(0, products.length));
  const pool = [];
  for (let n = 0; n < poolSize; n++) {
    const email = `seed-reviewer-${n + 1}@${SEED_EMAIL_DOMAIN}`;
    const user = await User.findOneAndUpdate(
      { email },
      { $setOnInsert: { fullName: nameFor(n), email, role: "customer", status: "active" } },
      { upsert: true, new: true }
    );
    pool.push(user);
  }

  // Wipe any previously seeded reviews so re-runs don't collide on the unique
  // (user, product) index. Only ever touches the fake reviewer pool.
  const poolIds = pool.map((u) => u._id);
  await Review.deleteMany({ user: { $in: poolIds } });

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let totalReviews = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const target = RATINGS[i];
    const count = COUNTS[i];

    // Compose ratings so the integer average matches the 2-decimal target:
    // fraction of 5-star reviews = target - 4 (e.g. 4.88 -> 88% fives).
    const fives = Math.round(count * (target - 4));
    const docs = [];
    for (let j = 0; j < count; j++) {
      // Rotate the pool per product so different products get different faces,
      // while staying within [0, poolSize) and distinct within this product.
      const user = pool[(j + i * 7) % poolSize];
      const rating = j < fives ? 5 : 4;
      // Spread creation dates over roughly the last 18 months, newest first.
      const createdAt = new Date(now - (j * 540 * DAY) / count - i * 3 * DAY);
      docs.push({
        user: user._id,
        product: product._id,
        rating,
        title: TITLES[(i + j) % TITLES.length],
        text: BODIES[(i * 3 + j) % BODIES.length],
        isVerifiedPurchase: true,
        isApproved: true,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await Review.insertMany(docs, { ordered: false });

    // Write the distinct target directly (see file header for why not recalc).
    product.averageRating = target;
    product.reviewCount = count;
    await product.save();

    totalReviews += count;
  }

  console.log(
    `  ✓ ${totalReviews} reviews seeded across ${products.length} products (ratings 4.60–4.99, ${poolSize} reviewers)`
  );
};

module.exports = seedReviews;
