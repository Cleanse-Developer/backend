const Address = require("../models/Address");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { parsePhone, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");

// GET /api/addresses
const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id }).sort({
    isDefault: -1,
    createdAt: -1,
  });
  res.json(ApiResponse.ok({ addresses }));
});

// POST /api/addresses
const addAddress = asyncHandler(async (req, res) => {
  const { label, fullName, phone, address1, address2, city, state, pincode, country, isDefault } =
    req.body;

  const parsedPhone = phone ? parsePhone(phone) : null;
  const localPhone = parsedPhone ? parsedPhone.number : phone;
  const phoneCountryCode = req.body.countryCode || (parsedPhone ? parsedPhone.countryCode : DEFAULT_COUNTRY_CODE);

  // If this is the user's first address, auto-set as default
  const count = await Address.countDocuments({ user: req.user._id });
  const shouldBeDefault = count === 0 ? true : isDefault || false;

  const address = await Address.create({
    user: req.user._id,
    label,
    fullName,
    phone: localPhone,
    countryCode: phoneCountryCode,
    address1,
    address2,
    city,
    state,
    pincode,
    country,
    isDefault: shouldBeDefault,
  });

  res.json(ApiResponse.created({ address }, "Address added"));
});

// PATCH /api/addresses/:id
const updateAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) throw ApiError.notFound("Address not found");

  const allowedFields = [
    "label", "fullName", "address1", "address2",
    "city", "state", "pincode", "country", "isDefault",
  ];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) address[field] = req.body[field];
  });

  // Normalise phone separately
  if (req.body.phone !== undefined) {
    const parsedPhone = parsePhone(req.body.phone);
    address.phone = parsedPhone ? parsedPhone.number : req.body.phone;
    address.countryCode = req.body.countryCode ||
      (parsedPhone ? parsedPhone.countryCode : DEFAULT_COUNTRY_CODE);
  } else if (req.body.countryCode !== undefined) {
    address.countryCode = req.body.countryCode;
  }

  await address.save();
  res.json(ApiResponse.ok({ address }, "Address updated"));
});

// DELETE /api/addresses/:id
const deleteAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!address) throw ApiError.notFound("Address not found");

  if (address.isDefault) {
    const firstRemaining = await Address.findOne({ user: req.user._id }).sort({ createdAt: -1 });
    if (firstRemaining) {
      firstRemaining.isDefault = true;
      await firstRemaining.save();
    }
  }

  res.json(ApiResponse.ok(null, "Address deleted"));
});

module.exports = { listAddresses, addAddress, updateAddress, deleteAddress };
