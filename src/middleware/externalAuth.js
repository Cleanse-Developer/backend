const crypto = require("crypto");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

// Auth for external-service integration endpoints (/api/external/*).
// Validates a FIXED bearer token (EXTERNAL_API_TOKEN in env) — not a JWT.
// The partner sends: Authorization: Bearer <EXTERNAL_API_TOKEN>.
// Compared in constant time to avoid leaking the token via timing.
const externalAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw ApiError.unauthorized("No token provided");
  }

  const token = authHeader.slice(7);
  const expected = env.EXTERNAL_API_TOKEN;

  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard first.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw ApiError.unauthorized("Invalid token");
  }

  next();
});

module.exports = externalAuth;
