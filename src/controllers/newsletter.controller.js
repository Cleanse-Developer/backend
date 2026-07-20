const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const Newsletter = require("../models/Newsletter");
const Coupon = require("../models/Coupon");
const Settings = require("../models/Settings");
const { sendWelcomeEmail } = require("../services/email.service");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCES = ["popup", "footer", "spin_wheel", "checkout"];

// Coupons issued on signup never expire (Coupon model requires validTill).
const NO_EXPIRY = new Date("2099-12-31");

// Read the admin-configured signup discount percent (default 10, clamped 1-100).
const getSignupDiscountPercent = async () => {
  const doc = await Settings.findOne({ key: "newsletterPopupConfig" }).lean();
  const raw = Number(doc?.value?.discountPercent);
  if (!Number.isFinite(raw)) return 10;
  return Math.min(100, Math.max(1, Math.round(raw)));
};

// Generate a unique WELCOME-{pct}-{HEX} coupon code with collision retry.
const generateSignupCouponCode = async (pct) => {
  for (let i = 0; i < 20; i++) {
    const bytes = i < 10 ? 4 : 6;
    const code = `WELCOME-${pct}-${crypto.randomBytes(bytes).toString("hex").toUpperCase()}`;
    const exists = await Coupon.exists({ code });
    if (!exists) return code;
  }
  throw new Error("Failed to generate unique newsletter coupon code after 20 attempts");
};

// Create a single-use percentage coupon for a new subscriber.
const issueSignupCoupon = async () => {
  const pct = await getSignupDiscountPercent();
  const code = await generateSignupCouponCode(pct);
  await Coupon.create({
    code,
    description: `Newsletter signup reward: ${pct}% off`,
    discountType: "percentage",
    discountValue: pct,
    validTill: NO_EXPIRY,
    usageLimit: 1,
    perUserLimit: 1,
    isActive: true,
  });
  return code;
};

const subscribe = asyncHandler(async (req, res) => {
  const { email, source } = req.body;

  if (!email || typeof email !== "string") {
    throw ApiError.badRequest("Email is required");
  }

  const trimmed = email.toLowerCase().trim();

  if (!EMAIL_RE.test(trimmed)) {
    throw ApiError.badRequest("Please enter a valid email address");
  }

  const safeSource = VALID_SOURCES.includes(source) ? source : "popup";

  // Look up existing record
  const existing = await Newsletter.findOne({ email: trimmed });

  if (existing) {
    // Don't silently reactivate admin-deactivated subscribers
    if (!existing.isActive) {
      throw ApiError.conflict(
        "This email was previously unsubscribed. Please contact support to reactivate."
      );
    }

    // Existing active subscriber. Issue the welcome coupon only if they don't
    // already have one (never mint a fresh coupon on repeats, or the form becomes
    // a coupon farm — this also covers addresses added by another flow like the
    // spin wheel, which upserts a record without a coupon). Then ALWAYS (re)send
    // the welcome email so every subscribe attempt actually delivers its email.
    let couponCode = existing.couponCode;
    let mutated = false;
    if (!couponCode) {
      couponCode = await issueSignupCoupon();
      existing.couponCode = couponCode;
      mutated = true;
    }
    if (!existing.unsubscribeToken) {
      existing.unsubscribeToken = crypto.randomBytes(32).toString("hex");
      mutated = true;
    }
    if (mutated) await existing.save();

    sendWelcomeEmail(existing, couponCode).catch((err) => {
      console.error("Newsletter welcome email failed:", err.message);
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { success: true, couponCode, alreadySubscribed: !mutated },
          "Subscribed to newsletter successfully"
        )
      );
  }

  // New subscriber: issue a single-use signup coupon, then insert with source
  // and a fresh unsubscribe token.
  const couponCode = await issueSignupCoupon();

  // Handle race: another concurrent request may have inserted between our
  // findOne() check and create(). MongoDB's unique index will throw E11000.
  let subscriber;
  try {
    subscriber = await Newsletter.create({
      email: trimmed,
      source: safeSource,
      isActive: true,
      couponCode,
      unsubscribeToken: crypto.randomBytes(32).toString("hex"),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      // Concurrent insert won the race — treat as already-subscribed.
      // Disable the orphaned coupon we just created so it can't be used.
      await Coupon.findOneAndUpdate({ code: couponCode }, { isActive: false });
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { success: true, alreadySubscribed: true },
            "Already subscribed"
          )
        );
    }
    throw err;
  }

  // Best-effort welcome email (non-blocking)
  sendWelcomeEmail(subscriber, couponCode).catch((err) => {
    console.error("Newsletter welcome email failed:", err.message);
  });

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { success: true, couponCode },
        "Subscribed to newsletter successfully"
      )
    );
});

// GET /api/newsletter/unsubscribe?token=xxx
// Returns a simple HTML page (so the link in an email is clickable)
const unsubscribe = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res
      .status(400)
      .send(renderUnsubscribePage("Invalid unsubscribe link.", false));
  }

  const subscriber = await Newsletter.findOne({ unsubscribeToken: token });
  if (!subscriber) {
    return res
      .status(404)
      .send(renderUnsubscribePage("This link is invalid or already used.", false));
  }

  if (!subscriber.isActive) {
    return res.send(
      renderUnsubscribePage("You're already unsubscribed.", true)
    );
  }

  subscriber.isActive = false;
  subscriber.unsubscribedAt = new Date();
  await subscriber.save();

  res.send(
    renderUnsubscribePage(
      "You've been unsubscribed from Cleanse Ayurveda newsletters. We're sorry to see you go!",
      true
    )
  );
});

function renderUnsubscribePage(message, success) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Unsubscribe — Cleanse Ayurveda</title>
  <style>
    body { font-family: Georgia, serif; background: #f7f4ef; color: #4f2c22; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; padding: 3rem 2.5rem; border-radius: 12px; max-width: 480px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
    h1 { font-size: 1.5rem; margin: 0 0 1rem; }
    p { font-size: 1rem; margin: 0 0 2rem; opacity: 0.8; }
    a { display: inline-block; padding: 0.75rem 2rem; background: #4f2c22; color: #fff; text-decoration: none; border-radius: 6px; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "✓" : "✕"}</div>
    <h1>${success ? "Unsubscribed" : "Unable to unsubscribe"}</h1>
    <p>${message}</p>
    <a href="/">Return home</a>
  </div>
</body>
</html>`;
}

module.exports = { subscribe, unsubscribe };
