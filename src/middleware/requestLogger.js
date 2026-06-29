const morgan = require("morgan");

// In production, log only errors (4xx/5xx) to cut access-log noise.
const requestLogger = morgan(
  process.env.NODE_ENV === "production" ? "combined" : "dev",
  process.env.NODE_ENV === "production"
    ? { skip: (req, res) => res.statusCode < 400 }
    : {}
);

module.exports = requestLogger;
