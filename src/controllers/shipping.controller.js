const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { checkServiceability } = require("../services/shiprocket.service");
const { resolveShippingConfig } = require("../services/pricing.service");
const ShippingZone = require("../models/ShippingZone");

const checkDelivery = asyncHandler(async (req, res) => {
  const { pincode, cod, weight } = req.body;

  if (!pincode || !/^\d{6}$/.test(pincode)) {
    throw ApiError.badRequest("Valid 6-digit pincode is required");
  }

  // Try shiprocket service first. cod defaults to 1 (checks COD-serviceable
  // couriers); pass cod:0 for a prepaid-only availability check.
  let result;
  try {
    result = await checkServiceability(pincode, weight || 0.5, cod === undefined ? 1 : cod ? 1 : 0);
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

/**
 * GET /api/shipping/config
 * Public — returns the active shipping rate + free-shipping threshold so the
 * storefront can display real (admin-configured) shipping. Optional ?pincode= /
 * ?state= narrows to a specific zone.
 *
 * With ?method=cod|razorpay → the single resolved config for that method.
 * Without ?method → a per-method breakdown { prepaid, cod, zone } PLUS prepaid's
 * fields promoted to the top level ({ standardRate, freeAbove }) so existing
 * callers that read the flat shape keep working.
 */
const getShippingConfig = asyncHandler(async (req, res) => {
  const { pincode, state, method } = req.query;
  const location = { pincode, state };

  if (method) {
    const config = await resolveShippingConfig(location, method);
    return res.status(200).json(new ApiResponse(200, config));
  }

  const [prepaid, cod] = await Promise.all([
    resolveShippingConfig(location, "prepaid"),
    resolveShippingConfig(location, "cod"),
  ]);
  // Promote prepaid to the top level for back-compat; expose both methods for
  // the storefront's "delivery charges" info tooltip.
  const config = { ...prepaid, prepaid, cod, zone: prepaid.zone };
  res.status(200).json(new ApiResponse(200, config));
});

module.exports = { checkDelivery, getShippingConfig };
