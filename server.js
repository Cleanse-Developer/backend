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

// Middleware stack
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
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

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV})`);
  });
};

start();

module.exports = app;
