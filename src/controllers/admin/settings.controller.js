const Settings = require("../../models/Settings");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { invalidateSettingsCache } = require("../settings.controller");

// GET /api/admin/settings
const getSettings = asyncHandler(async (req, res) => {
  const docs = await Settings.find().lean();

  // Convert array of { key, value } docs into a single key-value object
  const settings = {};
  for (const doc of docs) {
    settings[doc.key] = doc.value;
  }

  res.json(ApiResponse.ok(settings));
});

// PATCH /api/admin/settings
const updateSettings = asyncHandler(async (req, res) => {
  const updates = req.body;

  const bulkOps = Object.entries(updates).map(([key, value]) => ({
    updateOne: {
      filter: { key },
      update: { $set: { key, value } },
      upsert: true,
    },
  }));

  if (bulkOps.length > 0) {
    await Settings.bulkWrite(bulkOps);
    invalidateSettingsCache();
  }

  // Return updated settings
  const docs = await Settings.find().lean();
  const settings = {};
  for (const doc of docs) {
    settings[doc.key] = doc.value;
  }

  res.json(ApiResponse.ok(settings, "Settings updated"));
});

module.exports = { getSettings, updateSettings };
