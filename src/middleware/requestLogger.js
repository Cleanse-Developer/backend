const morgan = require("morgan");

const requestLogger = morgan(
  process.env.NODE_ENV === "production" ? "combined" : "dev"
);

module.exports = requestLogger;
