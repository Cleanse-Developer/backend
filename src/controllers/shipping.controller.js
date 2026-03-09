const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { checkServiceability } = require("../services/shiprocket.service");
const ShippingZone = require("../models/ShippingZone");

const checkDelivery = asyncHandler(async (req, res) => {
  const { pincode } = req.body;

  if (!pincode || !/^\d{6}$/.test(pincode)) {
    throw ApiError.badRequest("Valid 6-digit pincode is required");
  }

  // Try shiprocket service first
  let result;
  try {
    result = await checkServiceability(pincode);
  } catch (err) {
    // Fallback to ShippingZone model
    const zone = await ShippingZone.findOne({
      pincodes: pincode,
      isActive: true,
    });

    if (zone) {
      result = {
        available: true,
        estimatedDays: zone.estimatedDays.standard,
      };
    } else {
      result = {
        available: false,
        estimatedDays: null,
      };
    }
  }

  const message = result.available
    ? `Delivery available! Estimated ${result.estimatedDays} business days.`
    : "Sorry, delivery is not available to this pincode.";

  res
    .status(200)
    .json(new ApiResponse(200, { ...result, message }, message));
});

module.exports = { checkDelivery };
