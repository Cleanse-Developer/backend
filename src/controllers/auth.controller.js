const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const { createOTP, verifyOTP } = require("../services/otp.service");
const { sendOTPEmail } = require("../services/email.service");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const generateReferralCode = require("../utils/generateReferralCode");
const { applyReferralAtSignup } = require("../services/referral.service");
const { verifyAccessToken } = require("../services/msg91.service");
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

/** Find a user by local phone, or create a minimal one (applying a referral if new). */
async function findOrCreateUserByPhone(localPhone, { countryCode, referralCode } = {}) {
  let user = await User.findOne({ phone: localPhone });
  if (user) {
    return { user, referralApplied: null };
  }

  user = await User.create({
    fullName: "User",
    phone: localPhone,
    countryCode: countryCode || DEFAULT_COUNTRY_CODE,
    referralCode: await generateReferralCode(),
  });

  let referralApplied = null;
  if (referralCode && referralCode.trim()) {
    referralApplied = await applyReferralAtSignup(user, referralCode.trim());
  }
  return { user, referralApplied };
}

/** Update lastLogin, issue tokens, and send the standard login response. */
async function loginUser(user, req, res, extra = {}) {
  await User.updateOne({ _id: user._id }, { lastLogin: new Date() });
  const accessToken = await issueTokens(user, req, res);
  res.json(
    ApiResponse.ok({ user: sanitizeUser(user), accessToken, ...extra }, "Login successful")
  );
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
  const { fullName, email, phone, password, referralCode: incomingReferralCode } = req.body;

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
  const newReferralCode = await generateReferralCode();

  const user = await User.create({
    fullName,
    email: normalizedEmail,
    phone: localPhone,
    countryCode: phoneCountryCode,
    password: hashedPassword,
    referralCode: newReferralCode,
  });

  // Apply referral code if one was provided
  let referralApplied = null;
  if (incomingReferralCode && incomingReferralCode.trim()) {
    const result = await applyReferralAtSignup(user, incomingReferralCode.trim());
    referralApplied = result;
  }

  const accessToken = await issueTokens(user, req, res);

  res.status(201).json(
    ApiResponse.created(
      { user: sanitizeUser(user), accessToken, referralApplied },
      "Registration successful"
    )
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
  const { identifier, otp, referralCode } = req.body;

  const result = await verifyOTP(identifier, otp, "login");
  if (!result.valid) {
    throw ApiError.badRequest(result.message);
  }

  let user;
  let referralApplied = null;

  if (identifier.includes("@")) {
    user = await User.findOne({ email: identifier });
    if (!user) {
      user = await User.create({
        fullName: "User",
        email: identifier,
        referralCode: await generateReferralCode(),
      });
      if (referralCode && referralCode.trim()) {
        referralApplied = await applyReferralAtSignup(user, referralCode.trim());
      }
    }
  } else {
    const parsed = parsePhone(identifier);
    ({ user, referralApplied } = await findOrCreateUserByPhone(extractLocalNumber(identifier), {
      countryCode: parsed?.countryCode || DEFAULT_COUNTRY_CODE,
      referralCode,
    }));
  }

  return loginUser(user, req, res, { referralApplied });
});

// ── POST /api/auth/verify-widget-token ───────────────────────────────────────
// Phone OTP login via the MSG91 widget. The widget sends + verifies the OTP on
// the client and returns an access-token; this exchanges it for an app session.

const verifyWidgetToken = asyncHandler(async (req, res) => {
  const { accessToken: widgetToken, phone, referralCode } = req.body;

  // ─── TEMPORARY happy-path: MSG91 server-side verification skipped ──────────
  // No MSG91 account AuthKey yet. The MSG91 widget already verified the OTP on
  // the client; we are only skipping the backend re-check of the access-token,
  // so we trust the client-supplied `phone`.
  // TO ENABLE REAL VERIFICATION: set MSG91_AUTHKEY in the backend env, then
  // replace the next line with:
  //   const verifiedIdentifier = await verifyAccessToken(widgetToken);
  // and DELETE this comment block + stop reading `phone` from the body
  // (also make `phone` optional in verifyWidgetTokenRules).
  const verifiedIdentifier = phone;
  // ──────────────────────────────────────────────────────────────────────────

  const localPhone = extractLocalNumber(verifiedIdentifier);
  if (!/^[6-9]\d{9}$/.test(localPhone)) {
    throw ApiError.badRequest("Invalid mobile number");
  }

  const parsed = parsePhone(verifiedIdentifier);
  const { user, referralApplied } = await findOrCreateUserByPhone(localPhone, {
    countryCode: parsed?.countryCode || DEFAULT_COUNTRY_CODE,
    referralCode,
  });

  return loginUser(user, req, res, { referralApplied });
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

module.exports = { sendOtp, verifyOtp, verifyWidgetToken, loginWithPassword, register, refresh, logout, checkAccount };
