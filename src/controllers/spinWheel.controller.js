const Coupon = require("../models/Coupon");
const Newsletter = require("../models/Newsletter");
const SpinWheelPrize = require("../models/SpinWheelPrize");
const SpinWheelEntry = require("../models/SpinWheelEntry");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const crypto = require("crypto");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Spinning is now anonymous (no email) — the server still picks the prize, then
// hands back a short-lived HMAC-signed token binding that exact prize. Claim
// verifies the token so a client can't spin, then claim a different prize.
const SPIN_SECRET = process.env.JWT_ACCESS_SECRET || "spin-wheel-secret";
const SPIN_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes to claim after spinning

function signSpinToken(prizeValue) {
  const body = Buffer.from(
    JSON.stringify({ v: prizeValue, exp: Date.now() + SPIN_TOKEN_TTL_MS })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SPIN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// Returns { prizeValue } if the token is authentic and unexpired, else null.
function verifySpinToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SPIN_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload || typeof payload.v !== "string" || Date.now() > Number(payload.exp)) {
    return null;
  }
  return { prizeValue: payload.v };
}

// Newest non-expired reward/entry for an email (the one-per-email guard).
function activeEntry(emailKey) {
  return SpinWheelEntry.findOne({ email: emailKey, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .lean();
}

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

// POST /api/spin-wheel — spin the wheel (anonymous; no email needed)
// Picks the prize server-side and returns it with a signed token. The reward is
// NOT created here — the user claims it with their email afterwards.
const spin = asyncHandler(async (req, res) => {
  // A logged-in user who already has an active reward shouldn't re-spin — return
  // their existing (already-claimed) result, preserving one-per-account.
  if (req.user?.email) {
    const key = req.user.email.toLowerCase().trim();
    const existing = await activeEntry(key);
    if (existing) {
      return res.json(
        ApiResponse.ok(
          {
            prize: {
              label: existing.prize,
              value: existing.prizeValue,
              couponCode: existing.couponCode,
              isReward: !!existing.couponCode,
            },
            alreadySpun: true,
            claimed: true,
          },
          existing.couponCode ? "You already have an active reward!" : "You already spun recently!"
        )
      );
    }
  }

  const prize = await pickPrize();
  if (!prize) {
    throw ApiError.internal("No prizes configured. Please try again later.");
  }

  res.json(
    ApiResponse.ok(
      {
        prize: {
          label: prize.label,
          value: prize.value,
          isReward: !!prize.discountType,
        },
        spinToken: signSpinToken(prize.value),
      },
      "Spin complete"
    )
  );
});

// POST /api/spin-wheel/claim — claim the spun reward against an email.
// Requires the signed spinToken from /spin. Creates the coupon + entry and
// binds the reward to the email. One active reward per email.
const claim = asyncHandler(async (req, res) => {
  let { email, spinToken } = req.body;

  // Logged-in users always claim to their account email (prevent gaming).
  if (req.user?.email) {
    email = req.user.email;
  }

  if (!email || !EMAIL_RE.test(email)) {
    throw ApiError.badRequest("Valid email is required");
  }

  const decoded = verifySpinToken(spinToken);
  if (!decoded) {
    throw ApiError.badRequest("Your spin has expired. Please spin again.");
  }

  const key = email.toLowerCase().trim();

  // One reward per email — if they already have an active one, return it.
  const existing = await activeEntry(key);
  if (existing) {
    return res.json(
      ApiResponse.ok(
        {
          prize: {
            label: existing.prize,
            value: existing.prizeValue,
            couponCode: existing.couponCode,
            isReward: !!existing.couponCode,
          },
          alreadyClaimed: true,
        },
        existing.couponCode ? "You already have an active reward!" : "You already claimed recently!"
      )
    );
  }

  // Resolve the prize authoritatively from the signed value — never trust a
  // client-supplied label/discount.
  const prize = await SpinWheelPrize.findOne({
    value: decoded.prizeValue,
    isActive: true,
  }).lean();
  if (!prize) {
    throw ApiError.badRequest("This prize is no longer available. Please spin again.");
  }

  // "TRY AGAIN" — no coupon, 24h expiry so the user can retry next day.
  if (!prize.discountType) {
    await SpinWheelEntry.create({
      email: key,
      prize: prize.label,
      prizeValue: prize.value,
      couponCode: null,
      user: req.user?._id || null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await Newsletter.findOneAndUpdate(
      { email: key },
      { $setOnInsert: { email: key, source: "spin_wheel", isActive: true } },
      { upsert: true }
    ).catch(() => {});

    return res.json(
      ApiResponse.ok(
        { prize: { label: prize.label, value: prize.value, couponCode: null, isReward: false } },
        "Better luck next time!"
      )
    );
  }

  // WIN — generate a unique coupon code (retry on collision).
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

  await Newsletter.findOneAndUpdate(
    { email: key },
    { $setOnInsert: { email: key, source: "spin_wheel", isActive: true } },
    { upsert: true }
  ).catch(() => {});

  res.json(
    ApiResponse.ok(
      { prize: { label: prize.label, value: prize.value, couponCode: code, isReward: true } },
      "Congratulations!"
    )
  );
});

module.exports = { getPrizes, checkSpin, spin, claim };
