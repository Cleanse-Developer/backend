const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const RefreshToken = require("../../models/RefreshToken");
const { generateAccessToken, generateRefreshToken } = require("../../utils/generateToken");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");

// POST /api/admin/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw ApiError.badRequest("Email and password are required");
  }

  const user = await User.findOne({
    email,
    role: { $in: ["admin", "manager", "support"] },
  }).select("+password");

  if (!user) {
    throw ApiError.unauthorized("Invalid credentials");
  }

  if (user.status !== "active") {
    throw ApiError.unauthorized("Account is suspended or deactivated");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw ApiError.unauthorized("Invalid credentials");
  }

  user.lastLogin = new Date();
  await user.save();

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

  res.json(
    ApiResponse.ok(
      {
        user: {
          _id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
        },
        accessToken,
      },
      "Login successful"
    )
  );
});

// POST /api/admin/auth/logout
const logout = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.cookies;
  if (token) {
    await RefreshToken.deleteOne({ token });
  }
  res.clearCookie("refreshToken");
  res.json(ApiResponse.ok(null, "Logged out successfully"));
});

module.exports = { login, logout };
