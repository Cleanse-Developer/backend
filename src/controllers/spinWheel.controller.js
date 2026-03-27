const Coupon = require("../models/Coupon");
const Newsletter = require("../models/Newsletter");
const SpinWheelPrize = require("../models/SpinWheelPrize");
const SpinWheelEntry = require("../models/SpinWheelEntry");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const crypto = require("crypto");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateCode(value) {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `SPIN-${value.toUpperCase()}-${rand}`;
}

async function pickPrize() {
  const prizes = await SpinWheelPrize.find({ isActive: true }).lean();
  if (!prizes.length) return null;

  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return prizes[0];

  let rand = Math.random() * totalWeight;
  for (const prize of prizes) {
    rand -= prize.weight;
    if (rand <= 0) return prize;
  }
  return prizes[0];
}

// GET /api/spin-wheel/prizes — public, returns active prizes for wheel rendering
const getPrizes = asyncHandler(async (req, res) => {
  const prizes = await SpinWheelPrize.find({ isActive: true })
    .sort({ _id: 1 })
    .select("label value color textColor")
    .lean();

  res.json(ApiResponse.ok({ prizes }));
});

// GET /api/spin-wheel/check?email=X — check if email already has an active spin
const checkSpin = asyncHandler(async (req, res) => {
  const { email } = req.query;

  if (!email || !EMAIL_RE.test(email)) {
    throw ApiError.badRequest("Valid email is required");
  }

  const key = email.toLowerCase().trim();

  const entry = await SpinWheelEntry.findOne({
    email: key,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (entry) {
    return res.json(
      ApiResponse.ok({
        hasSpun: true,
        prize: {
          label: entry.prize,
          value: entry.prizeValue,
          couponCode: entry.couponCode,
        },
      })
    );
  }

  res.json(ApiResponse.ok({ hasSpun: false }));
});

// POST /api/spin-wheel — spin the wheel
const spin = asyncHandler(async (req, res) => {
  let { email } = req.body;

  // If user is logged in, force their account email (prevent gaming)
  if (req.user?.email) {
    email = req.user.email;
  }

  if (!email || !EMAIL_RE.test(email)) {
    throw ApiError.badRequest("Valid email is required");
  }

  const key = email.toLowerCase().trim();

  // Check for existing active spin
  const existing = await SpinWheelEntry.findOne({
    email: key,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (existing) {
    // Return existing result instead of an error (friendlier UX)
    return res.json(
      ApiResponse.ok(
        {
          prize: {
            label: existing.prize,
            value: existing.prizeValue,
            couponCode: existing.couponCode,
          },
          alreadySpun: true,
        },
        existing.couponCode ? "You already have an active reward!" : "You already spun recently!"
      )
    );
  }

  const prize = await pickPrize();
  if (!prize) {
    throw ApiError.internal("No prizes configured. Please try again later.");
  }

  // "TRY AGAIN" — no coupon, 24h expiry so user can retry next day
  if (!prize.discountType) {
    const entry = await SpinWheelEntry.create({
      email: key,
      prize: prize.label,
      prizeValue: prize.value,
      couponCode: null,
      user: req.user?._id || null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // Subscribe to newsletter
    Newsletter.findOneAndUpdate(
      { email: key },
      { $setOnInsert: { email: key, source: "spin_wheel", isActive: true } },
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
    const exists = await Coupon.findOne({ code }).lean();
    if (!exists) break;
    attempts++;
    if (attempts >= MAX_ATTEMPTS) {
      throw ApiError.internal("Could not generate unique coupon code. Please try again.");
    }
  }

  const validTill = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const coupon = await Coupon.create({
    code,
    description: `Spin Wheel reward: ${prize.label}`,
    discountType: prize.discountType,
    discountValue: prize.discountValue,
    validTill,
    usageLimit: 1,
    perUserLimit: 1,
    isActive: true,
  });

  await SpinWheelEntry.create({
    email: key,
    prize: prize.label,
    prizeValue: prize.value,
    couponCode: code,
    coupon: coupon._id,
    user: req.user?._id || null,
    expiresAt: validTill,
  });

  // Subscribe to newsletter
  Newsletter.findOneAndUpdate(
    { email: key },
    { $setOnInsert: { email: key, source: "spin_wheel", isActive: true } },
    { upsert: true }
  ).exec();

  res.json(
    ApiResponse.ok(
      { prize: { label: prize.label, value: prize.value, couponCode: code } },
      "Congratulations!"
    )
  );
});

module.exports = { getPrizes, checkSpin, spin };
