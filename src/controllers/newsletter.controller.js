const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const Newsletter = require("../models/Newsletter");
const { sendWelcomeEmail } = require("../services/email.service");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCES = ["popup", "footer", "spin_wheel", "checkout"];

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
    // Already active — return success without overwriting source
    return res
      .status(200)
      .json(new ApiResponse(200, { success: true, alreadySubscribed: true }, "Already subscribed"));
  }

  // New subscriber: insert with source and a fresh unsubscribe token.
  // Handle race: another concurrent request may have inserted between our
  // findOne() check and create(). MongoDB's unique index will throw E11000.
  let subscriber;
  try {
    subscriber = await Newsletter.create({
      email: trimmed,
      source: safeSource,
      isActive: true,
      unsubscribeToken: crypto.randomBytes(32).toString("hex"),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      // Concurrent insert won the race — treat as already-subscribed
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
  sendWelcomeEmail(subscriber).catch((err) => {
    console.error("Newsletter welcome email failed:", err.message);
  });

  res
    .status(200)
    .json(
      new ApiResponse(200, { success: true }, "Subscribed to newsletter successfully")
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
