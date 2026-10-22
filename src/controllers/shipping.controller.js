const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { checkServiceability } = require("../services/shiprocket.service");
const { resolveShippingConfig } = require("../services/pricing.service");
const { resolveFreeAbove } = require("../services/shippingRate.service");
const { getConfig: getChargeMode } = require("../utils/shippingChargeMode");
const { getGiftWrapCost } = require("../utils/giftWrapCost");
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

  // `source` / `recommendedCourierId` are internal (used by the pricing engine).
  const { source, recommendedCourierId, ...publicResult } = result;

  res
    .status(200)
    .json(new ApiResponse(200, { ...publicResult, message }, message));
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

  const chargeMode = await getChargeMode();
  // Free-delivery amount actually in force: in dynamic mode the admin can keep the
  // static amount, set a custom one, or switch free delivery off (null here).
  const withFreeRule = (cfg) => {
    const freeAbove = resolveFreeAbove(chargeMode, cfg.freeAbove);
    return { ...cfg, freeAbove: Number.isFinite(freeAbove) ? freeAbove : null };
  };

  if (method) {
    const config = withFreeRule(await resolveShippingConfig(location, method));
    return res
      .status(200)
      .json(new ApiResponse(200, { ...config, chargeMode: chargeMode.mode }));
  }

  const [prepaidRaw, codRaw, giftWrapCost] = await Promise.all([
    resolveShippingConfig(location, "prepaid"),
    resolveShippingConfig(location, "cod"),
    getGiftWrapCost(),
  ]);
  const prepaid = withFreeRule(prepaidRaw);
  const cod = withFreeRule(codRaw);
  // Promote prepaid to the top level for back-compat; expose both methods for
  // the storefront's "delivery charges" info tooltip. chargeMode tells the
  // storefront whether the rates above are the charge ("static") or only the
  // fallback for a live Shiprocket quote ("dynamic").
  const config = {
    ...prepaid,
    prepaid,
    cod,
    zone: prepaid.zone,
    chargeMode: chargeMode.mode,
    giftWrapCost,
  };
  res.status(200).json(new ApiResponse(200, config));
});

module.exports = { checkDelivery, getShippingConfig };
