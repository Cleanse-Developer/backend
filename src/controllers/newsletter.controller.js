const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const Newsletter = require("../models/Newsletter");

const subscribe = asyncHandler(async (req, res) => {
  const { email, source } = req.body;

  if (!email) {
    const ApiError = require("../utils/ApiError");
    throw ApiError.badRequest("Email is required");
  }

  await Newsletter.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    {
      email: email.toLowerCase().trim(),
      source: source || "popup",
      isActive: true,
    },
    { upsert: true, new: true }
  );

  res
    .status(200)
    .json(
      new ApiResponse(200, { success: true }, "Subscribed to newsletter successfully")
    );
});

module.exports = { subscribe };
