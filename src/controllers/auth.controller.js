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
const { parsePhone, extractLocalNumber, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Build a consistent user-data object for API responses. */
function sanitizeUser(user) {
  return {
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    countryCode: user.countryCode,
    role: user.role,
    loyaltyPoints: user.loyaltyPoints,
    preferences: user.preferences,
  };
}

/** Create tokens, persist refresh token, set cookie, return both tokens. */
async function issueTokens(user, req, res) {
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

  return accessToken;
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────

const loginWithPassword = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw ApiError.badRequest("Email and password are required");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user) {
    throw ApiError.unauthorized("No account found with this email");
  }
  if (!user.password) {
    throw ApiError.unauthorized("This account was created via OTP. Please use OTP login or reset your password");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw ApiError.unauthorized("Incorrect password");
  }

  // Update last login (use updateOne to avoid re-saving the +password doc)
  await User.updateOne({ _id: user._id }, { lastLogin: new Date() });

  const accessToken = await issueTokens(user, req, res);

  res.json(
    ApiResponse.ok({ user: sanitizeUser(user), accessToken }, "Login successful")
  );
});

// ── POST /api/auth/register ──────────────────────────────────────────────────

const register = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password } = req.body;

  // Normalize inputs
  const normalizedEmail = email.toLowerCase().trim();
  const parsed = parsePhone(phone);
  const localPhone = parsed ? parsed.number : phone;
  const phoneCountryCode = req.body.countryCode || (parsed ? parsed.countryCode : DEFAULT_COUNTRY_CODE);

  // Duplicate check (use normalized values)
  const existing = await User.findOne({
    $or: [{ email: normalizedEmail }, { phone: localPhone }],
  });
  if (existing) {
    if (existing.email === normalizedEmail) {
      throw ApiError.conflict("An account with this email already exists");
    }
    throw ApiError.conflict("An account with this phone number already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await User.create({
    fullName,
    email: normalizedEmail,
    phone: localPhone,
    countryCode: phoneCountryCode,
    password: hashedPassword,
    referralCode: generateReferralCode(),
  });

  const accessToken = await issueTokens(user, req, res);

  res.status(201).json(
    ApiResponse.created({ user: sanitizeUser(user), accessToken }, "Registration successful")
  );
});

// ── POST /api/auth/send-otp ──────────────────────────────────────────────────

const sendOtp = asyncHandler(async (req, res) => {
  const { identifier } = req.body;

  const otp = await createOTP(identifier, "login");

  if (identifier.includes("@")) {
    await sendOTPEmail(identifier, otp);
  } else {
    console.log(`[SMS] OTP for ${identifier}: ${otp}`);
  }

  const resp = ApiResponse.ok(null, "OTP sent successfully");
  if (process.env.NODE_ENV === "development") {
    resp.data = { otp };
  }
  res.json(resp);
});

// ── POST /api/auth/verify-otp ────────────────────────────────────────────────

const verifyOtp = asyncHandler(async (req, res) => {
  const { identifier, otp } = req.body;

  const result = await verifyOTP(identifier, otp, "login");
  if (!result.valid) {
    throw ApiError.badRequest(result.message);
  }

  const isEmail = identifier.includes("@");
  const localPhone = isEmail ? null : extractLocalNumber(identifier);
  const query = isEmail ? { email: identifier } : { phone: localPhone };
  let user = await User.findOne(query);

  if (!user) {
    const parsed = isEmail ? null : parsePhone(identifier);
    user = await User.create({
      fullName: "User",
      email: isEmail ? identifier : undefined,
      phone: isEmail ? undefined : localPhone,
      countryCode: isEmail ? undefined : (parsed?.countryCode || DEFAULT_COUNTRY_CODE),
      referralCode: generateReferralCode(),
    });
  }

  await User.updateOne({ _id: user._id }, { lastLogin: new Date() });

  const accessToken = await issueTokens(user, req, res);

  res.json(
    ApiResponse.ok({ user: sanitizeUser(user), accessToken }, "Login successful")
  );
});

// ── POST /api/auth/refresh ───────────────────────────────────────────────────

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

// ── POST /api/auth/logout ────────────────────────────────────────────────────

const logout = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.cookies;
  if (token) {
    await RefreshToken.deleteOne({ token });
  }
  res.clearCookie("refreshToken");
  res.json(ApiResponse.ok(null, "Logged out successfully"));
});

// ── POST /api/auth/check-account ─────────────────────────────────────────────

const checkAccount = asyncHandler(async (req, res) => {
  const { email, phone } = req.body;

  const localPhone = phone ? extractLocalNumber(phone) : "";

  const emailUser = email
    ? await User.findOne({ email: email.toLowerCase() }).select("_id")
    : null;

  const phoneUser = localPhone
    ? await User.findOne({ phone: localPhone }).select("_id")
    : null;

  const emailExists = !!emailUser;
  const phoneExists = !!phoneUser;
  let sameAccount = false;

  if (emailExists && phoneExists) {
    sameAccount = emailUser._id.toString() === phoneUser._id.toString();
  }

  res.json(
    ApiResponse.ok({ emailExists, phoneExists, sameAccount })
  );
});

module.exports = { sendOtp, verifyOtp, loginWithPassword, register, refresh, logout, checkAccount };
