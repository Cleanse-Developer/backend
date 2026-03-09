const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const { createOTP, verifyOTP } = require("../services/otp.service");
const { sendOTPEmail } = require("../services/email.service");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const generateReferralCode = require("../utils/generateReferralCode");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");

// POST /api/auth/send-otp
const sendOtp = asyncHandler(async (req, res) => {
  const { identifier } = req.body;

  const otp = await createOTP(identifier, "login");

  // Send OTP via email (log in dev)
  if (identifier.includes("@")) {
    await sendOTPEmail(identifier, otp);
  } else {
    // SMS integration placeholder — log for dev
    console.log(`[SMS] OTP for ${identifier}: ${otp}`);
  }

  const resp = ApiResponse.ok(null, "OTP sent successfully");
  // In development, include OTP for testing
  if (process.env.NODE_ENV === "development") {
    resp.data = { otp };
  }
  res.json(resp);
});

// POST /api/auth/verify-otp
const verifyOtp = asyncHandler(async (req, res) => {
  const { identifier, otp } = req.body;

  const result = await verifyOTP(identifier, otp, "login");
  if (!result.valid) {
    throw ApiError.badRequest(result.message);
  }

  // Find or create user
  const query = identifier.includes("@") ? { email: identifier } : { phone: identifier };
  let user = await User.findOne(query);

  if (!user) {
    // Auto-create user on first OTP login
    user = await User.create({
      fullName: "User",
      email: identifier.includes("@") ? identifier : undefined,
      phone: !identifier.includes("@") ? identifier : undefined,
      referralCode: generateReferralCode(),
    });
  }

  user.lastLogin = new Date();
  await user.save();

  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);

  // Store refresh token
  await RefreshToken.create({
    user: user._id,
    token: refreshToken,
    userAgent: req.headers["user-agent"],
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  // Set refresh token in httpOnly cookie
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json(
    ApiResponse.ok({
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        loyaltyPoints: user.loyaltyPoints,
      },
      accessToken,
    }, "Login successful")
  );
});

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password } = req.body;

  // Check if user exists
  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) {
    throw ApiError.conflict("User with this email or phone already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await User.create({
    fullName,
    email,
    phone,
    password: hashedPassword,
    referralCode: generateReferralCode(),
  });

  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);

  await RefreshToken.create({
    user: user._id,
    token: refreshToken,
    userAgent: req.headers["user-agent"],
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(201).json(
    ApiResponse.created({
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        loyaltyPoints: user.loyaltyPoints,
      },
      accessToken,
    }, "Registration successful")
  );
});

// POST /api/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.cookies;
  if (!token) {
    throw ApiError.unauthorized("No refresh token");
  }

  const stored = await RefreshToken.findOne({ token });
  if (!stored || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const jwt = require("jsonwebtoken");
  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  const user = await User.findById(decoded.id);
  if (!user) {
    throw ApiError.unauthorized("User not found");
  }

  const accessToken = generateAccessToken(user._id, user.role);

  res.json(ApiResponse.ok({ accessToken }, "Token refreshed"));
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.cookies;
  if (token) {
    await RefreshToken.deleteOne({ token });
  }
  res.clearCookie("refreshToken");
  res.json(ApiResponse.ok(null, "Logged out successfully"));
});

module.exports = { sendOtp, verifyOtp, register, refresh, logout };
