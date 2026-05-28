const Newsletter = require("../../models/Newsletter");
const Settings = require("../../models/Settings");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");
const { invalidateSettingsCache } = require("../settings.controller");

// GET /api/admin/newsletter/subscribers
const listSubscribers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, source, status } = req.query;

  const filter = {};
  if (search) {
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.email = { $regex: escaped, $options: "i" };
  }
  if (source) {
    filter.source = source;
  }
  if (status === "active") {
    filter.isActive = true;
  } else if (status === "inactive") {
    filter.isActive = false;
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [subscribers, total] = await Promise.all([
    Newsletter.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Newsletter.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      subscribers,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/newsletter/stats
const getStats = asyncHandler(async (req, res) => {
  const [total, active, inactive, bySources] = await Promise.all([
    Newsletter.countDocuments(),
    Newsletter.countDocuments({ isActive: true }),
    Newsletter.countDocuments({ isActive: false }),
    Newsletter.aggregate([
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const sources = {};
  for (const s of bySources) {
    sources[s._id] = s.count;
  }

  res.json(ApiResponse.ok({ total, active, inactive, sources }));
});

// GET /api/admin/newsletter/export
const exportSubscribers = asyncHandler(async (req, res) => {
  const { status } = req.query;

  const filter = {};
  if (status === "active") filter.isActive = true;
  else if (status === "inactive") filter.isActive = false;

  const subscribers = await Newsletter.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  // CSV format — escape fields to prevent formula injection
  const escapeCSV = (val) => {
    const str = String(val);
    if (/[",\n\r]/.test(str) || /^[=+\-@\t\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = "Email,Source,Status,Subscribed Date";
  const rows = subscribers.map(
    (s) =>
      `${escapeCSV(s.email)},${escapeCSV(s.source)},${s.isActive ? "active" : "inactive"},${new Date(s.createdAt).toISOString()}`
  );
  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=newsletter-subscribers.csv");
  res.send(csv);
});

// PATCH /api/admin/newsletter/toggle
const toggleNewsletterPopup = asyncHandler(async (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== "boolean") {
    throw ApiError.badRequest("enabled must be a boolean");
  }

  await Settings.findOneAndUpdate(
    { key: "newsletterPopupEnabled" },
    { key: "newsletterPopupEnabled", value: enabled },
    { upsert: true }
  );

  invalidateSettingsCache();

  res.json(
    ApiResponse.ok(
      { enabled },
      `Newsletter popup ${enabled ? "enabled" : "disabled"}`
    )
  );
});

// PATCH /api/admin/newsletter/config
const updatePopupConfig = asyncHandler(async (req, res) => {
  const { tag, heading, description, note, image, delaySeconds } = req.body;

  const config = {};
  if (tag !== undefined) config.tag = String(tag).slice(0, 100);
  if (heading !== undefined) config.heading = String(heading).slice(0, 100);
  if (description !== undefined) config.description = String(description).slice(0, 500);
  if (note !== undefined) config.note = String(note).slice(0, 200);
  if (image !== undefined) config.image = image ? String(image).slice(0, 500) : null;
  if (delaySeconds !== undefined) {
    const val = Number(delaySeconds);
    if (isNaN(val) || val < 1 || val > 120) {
      throw ApiError.badRequest("delaySeconds must be between 1 and 120");
    }
    config.delaySeconds = val;
  }

  // Merge with existing config
  const existing = await Settings.findOne({ key: "newsletterPopupConfig" }).lean();
  const merged = { ...(existing?.value || {}), ...config };

  await Settings.findOneAndUpdate(
    { key: "newsletterPopupConfig" },
    { key: "newsletterPopupConfig", value: merged },
    { upsert: true }
  );

  invalidateSettingsCache();

  res.json(ApiResponse.ok({ config: merged }, "Newsletter popup config updated"));
});

// GET /api/admin/newsletter/config
const getPopupConfig = asyncHandler(async (req, res) => {
  const doc = await Settings.findOne({ key: "newsletterPopupConfig" }).lean();
  const enabled = await Settings.findOne({ key: "newsletterPopupEnabled" }).lean();

  res.json(
    ApiResponse.ok({
      enabled: enabled?.value ?? true,
      config: doc?.value || {},
    })
  );
});

// DELETE /api/admin/newsletter/subscribers/:id
const deleteSubscriber = asyncHandler(async (req, res) => {
  const subscriber = await Newsletter.findByIdAndDelete(req.params.id);
  if (!subscriber) {
    throw ApiError.notFound("Subscriber not found");
  }
  res.json(ApiResponse.ok(null, "Subscriber removed"));
});

// PATCH /api/admin/newsletter/subscribers/:id/toggle
const toggleSubscriber = asyncHandler(async (req, res) => {
  const subscriber = await Newsletter.findById(req.params.id);
  if (!subscriber) {
    throw ApiError.notFound("Subscriber not found");
  }

  subscriber.isActive = !subscriber.isActive;
  await subscriber.save();

  res.json(
    ApiResponse.ok(
      { subscriber },
      `Subscriber ${subscriber.isActive ? "activated" : "deactivated"}`
    )
  );
});

module.exports = {
  listSubscribers,
  getStats,
  exportSubscribers,
  toggleNewsletterPopup,
  updatePopupConfig,
  getPopupConfig,
  deleteSubscriber,
  toggleSubscriber,
};
