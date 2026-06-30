require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const mongoSanitize = require("express-mongo-sanitize");

// Validate environment
require("./src/config/env");

const connectDB = require("./src/config/db");
const corsOptions = require("./src/config/cors");
const requestLogger = require("./src/middleware/requestLogger");
const { globalLimiter } = require("./src/middleware/rateLimiter");
const errorHandler = require("./src/middleware/errorHandler");
const notFound = require("./src/middleware/notFound");
const routes = require("./src/routes");

const app = express();
const PORT = process.env.PORT || 5000;

// Behind CloudFront/nginx — trust the first proxy hop so express-rate-limit
// reads the real client IP from X-Forwarded-For instead of throwing.
app.set("trust proxy", 1);

// Middleware stack
app.use(helmet());
app.use(cors(corsOptions));
app.use(
  express.json({
    limit: "10mb",
    // Preserve the exact raw request bytes for HMAC signature verification
    // (Razorpay webhooks must be validated against the raw body, not re-serialized JSON).
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(requestLogger);
app.use(globalLimiter);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Cleanse Ayurveda API is running" });
});

// API routes
app.use("/api", routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const start = async () => {
  await connectDB();

  // Auto-seed spin wheel prizes if none exist
  const seedSpinWheelPrizes = require("./src/seeds/spinWheelPrizes.seed");
  seedSpinWheelPrizes().catch((err) => console.error("Spin wheel seed error:", err));

  // Start Agenda.js job scheduler
  const agenda = require("./src/config/agenda");
  require("./src/jobs/expirePaymentSession");
  require("./src/jobs/loyaltyExpiry");
  require("./src/jobs/createShiprocketOrder");
  require("./src/jobs/expireStaleOrders");
  require("./src/jobs/syncInstagramReels");
  await agenda.start();

  // Sweep stale unconfirmed COD orders hourly.
  const existingStale = await agenda.jobs({ name: "expire-stale-orders" });
  if (existingStale.length === 0) {
    await agenda.every("1 hour", "expire-stale-orders");
  }

  // Schedule daily cleanup job if not already scheduled
  const existingPurge = await agenda.jobs({ name: "purge-old-jobs" });
  if (existingPurge.length === 0) {
    await agenda.every("24 hours", "purge-old-jobs");
  }

  // Schedule daily loyalty expiry job
  const existingExpiry = await agenda.jobs({ name: "expire-loyalty-points" });
  if (existingExpiry.length === 0) {
    await agenda.every("24 hours", "expire-loyalty-points");
  }

  // Sync Instagram reels daily (only meaningful when IG creds are configured).
  if (process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN) {
    const existingIgSync = await agenda.jobs({ name: "sync-instagram-reels" });
    if (existingIgSync.length === 0) {
      await agenda.every("24 hours", "sync-instagram-reels");
    }
  }

  // Recover any newsletter campaigns that were stuck in "sending" when the
  // server last shut down. Mark them as failed so admins can manually re-send.
  try {
    const NewsletterCampaign = require("./src/models/NewsletterCampaign");
    const stuck = await NewsletterCampaign.updateMany(
      {
        status: "sending",
        updatedAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) }, // 1h+ stale
      },
      { $set: { status: "failed" } }
    );
    if (stuck.modifiedCount > 0) {
      console.log(`Recovered ${stuck.modifiedCount} stuck newsletter campaigns`);
    }
  } catch (err) {
    console.error("Stuck campaign cleanup error:", err.message);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV})`);
  });

  // Warm the WhatsApp order-assistant: spawn the MCP tool subprocess and build
  // the agent once, after the server is listening (tools call back into /api).
  // Best-effort — a failure here must not stop the server.
  const aiService = require("./src/services/ai.service");
  aiService
    .init()
    .catch((err) => console.error("[ai] agent warm-up failed:", err.message));

  // Graceful shutdown
  const gracefulShutdown = async () => {
    console.log("Shutting down gracefully...");
    await agenda.stop();
    await aiService.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
};

start();

module.exports = app;
