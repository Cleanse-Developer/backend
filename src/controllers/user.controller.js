const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

// GET /api/user/profile
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password -__v");

  if (!user) {
    throw ApiError.notFound("User not found");
  }

  res.json(ApiResponse.ok({ user }));
});

// PATCH /api/user/profile
const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, email, phone, dateOfBirth } = req.body;

  const updates = {};
  if (fullName !== undefined) updates.fullName = fullName;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth;

  const user = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  }).select("-password -__v");

  if (!user) {
    throw ApiError.notFound("User not found");
  }

  res.json(ApiResponse.ok({ user }, "Profile updated"));
});

// PATCH /api/user/preferences
const updatePreferences = asyncHandler(async (req, res) => {
  const { orderUpdates, promotions, newsletter } = req.body;

  const updates = {};
  if (orderUpdates !== undefined)
    updates["preferences.orderUpdates"] = orderUpdates;
  if (promotions !== undefined)
    updates["preferences.promotions"] = promotions;
  if (newsletter !== undefined)
    updates["preferences.newsletter"] = newsletter;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updates },
    { new: true, runValidators: true }
  ).select("-password -__v");

  if (!user) {
    throw ApiError.notFound("User not found");
  }

  res.json(ApiResponse.ok({ user }, "Preferences updated"));
});

module.exports = { getProfile, updateProfile, updatePreferences };
