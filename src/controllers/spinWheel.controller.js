const Coupon = require("../models/Coupon");
const Newsletter = require("../models/Newsletter");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const crypto = require("crypto");

// Weighted prize pool
const PRIZES = [
  { label: "10% OFF",   value: "10off",    weight: 25, discountType: "percentage", discountValue: 10 },
  { label: "FREE SHIP", value: "freeship", weight: 20, discountType: "free_shipping", discountValue: 0 },
  { label: "5% OFF",    value: "5off",     weight: 30, discountType: "percentage", discountValue: 5 },
  { label: "TRY AGAIN", value: "tryagain", weight: 15, discountType: null, discountValue: 0 },
  { label: "15% OFF",   value: "15off",    weight: 5,  discountType: "percentage", discountValue: 15 },
  { label: "FREE GIFT", value: "sample",   weight: 5,  discountType: "fixed", discountValue: 200 },
];

// In-memory rate limit: email -> last spin timestamp
const spinHistory = new Map();
const RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodic cleanup: remove expired entries every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [email, timestamp] of spinHistory) {
    if (now - timestamp > RATE_LIMIT_MS) {
      spinHistory.delete(email);
    }
  }
}, 60 * 60 * 1000);

function pickPrize() {
  const totalWeight = PRIZES.reduce((sum, p) => sum + p.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const prize of PRIZES) {
    rand -= prize.weight;
    if (rand <= 0) return prize;
  }
  return PRIZES[0];
}

function generateCode(value) {
  // Use crypto for better randomness + longer suffix to reduce collision chance
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `SPIN-${value.toUpperCase()}-${rand}`;
}

// POST /api/spin-wheel
const spin = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest("Valid email is required");
  }

  const key = email.toLowerCase().trim();

  // Rate limit: 1 spin per email per 24 hours
  const lastSpin = spinHistory.get(key);
  if (lastSpin && Date.now() - lastSpin < RATE_LIMIT_MS) {
    throw ApiError.tooMany("You can only spin once every 24 hours");
  }

  const prize = pickPrize();

  // "TRY AGAIN" -- no coupon, but still record the spin and subscribe
  if (prize.value === "tryagain") {
    spinHistory.set(key, Date.now());

    // Subscribe without overwriting existing source
    Newsletter.findOneAndUpdate(
      { email: key },
      { $setOnInsert: { email: key, source: "spin-wheel", isActive: true } },
      { upsert: true }
    ).exec();

    return res.json(
      ApiResponse.ok(
        { prize: { label: prize.label, value: prize.value, couponCode: null } },
        "Better luck next time!"
      )
    );
  }

  // Generate unique coupon code with retry on collision
  let code;
  let attempts = 0;
  const MAX_ATTEMPTS = 3;

  while (attempts < MAX_ATTEMPTS) {
    code = generateCode(prize.value);
    const existing = await Coupon.findOne({ code }).lean();
    if (!existing) break;
    attempts++;
    if (attempts >= MAX_ATTEMPTS) {
      throw ApiError.internal("Could not generate unique coupon code. Please try again.");
    }
  }

  const validTill = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await Coupon.create({
    code,
    description: `Spin Wheel reward: ${prize.label}`,
    discountType: prize.discountType || "percentage",
    discountValue: prize.discountValue,
    validTill,
    usageLimit: 1,
    perUserLimit: 1,
    isActive: true,
  });

  // Record spin AFTER successful coupon creation (so a failed DB write doesn't block retries)
  spinHistory.set(key, Date.now());

  // Subscribe without overwriting existing source
  Newsletter.findOneAndUpdate(
    { email: key },
    { $setOnInsert: { email: key, source: "spin-wheel", isActive: true } },
    { upsert: true }
  ).exec();

  res.json(
    ApiResponse.ok(
      { prize: { label: prize.label, value: prize.value, couponCode: code } },
      "Congratulations!"
    )
  );
});

module.exports = { spin };
