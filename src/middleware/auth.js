const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const auth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw ApiError.unauthorized("No token provided");
  }

  const token = authHeader.split(" ")[1];
  const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

  const user = await User.findById(decoded.id).select("-password");
  if (!user || user.status !== "active") {
    throw ApiError.unauthorized("User not found or deactivated");
  }

  req.user = user;
  next();
});

// Optional auth — sets req.user if token present, but doesn't require it
const optionalAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.id).select("-password");
      if (user && user.status === "active") {
        req.user = user;
      }
    } catch {
      // Token invalid — continue as guest
    }
  }
  next();
});

module.exports = { auth, optionalAuth };
