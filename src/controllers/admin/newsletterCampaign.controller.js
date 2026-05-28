const asyncHandler = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/ApiResponse");
const ApiError = require("../../utils/ApiError");
const { paginationMeta } = require("../../utils/pagination");
const NewsletterCampaign = require("../../models/NewsletterCampaign");
const Newsletter = require("../../models/Newsletter");
const { sendBulkNewsletter } = require("../../services/email.service");

// GET /api/admin/newsletter/campaigns
const listCampaigns = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const status = req.query.status;

  const filter = {};
  if (status) filter.status = status;

  const [campaigns, total] = await Promise.all([
    NewsletterCampaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "fullName email")
      .lean(),
    NewsletterCampaign.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      campaigns,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// GET /api/admin/newsletter/campaigns/:id
const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await NewsletterCampaign.findById(req.params.id)
    .populate("createdBy", "fullName email")
    .lean();
  if (!campaign) throw ApiError.notFound("Campaign not found");
  res.json(ApiResponse.ok({ campaign }));
});

// POST /api/admin/newsletter/campaigns
const createCampaign = asyncHandler(async (req, res) => {
  const { subject, htmlContent, plainContent, scheduledFor } = req.body;

  if (!subject || !subject.trim()) {
    throw ApiError.badRequest("Subject is required");
  }
  if (!htmlContent || !htmlContent.trim()) {
    throw ApiError.badRequest("Content is required");
  }

  const campaign = await NewsletterCampaign.create({
    subject: subject.trim().slice(0, 200),
    htmlContent,
    plainContent,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    status: scheduledFor ? "scheduled" : "draft",
    createdBy: req.user._id,
  });

  res.status(201).json(ApiResponse.created({ campaign }, "Campaign created"));
});

// PATCH /api/admin/newsletter/campaigns/:id
const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await NewsletterCampaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound("Campaign not found");

  if (campaign.status === "sent" || campaign.status === "sending") {
    throw ApiError.conflict("Cannot edit a campaign that has been sent or is sending");
  }

  const { subject, htmlContent, plainContent, scheduledFor } = req.body;
  if (subject !== undefined) campaign.subject = String(subject).trim().slice(0, 200);
  if (htmlContent !== undefined) campaign.htmlContent = htmlContent;
  if (plainContent !== undefined) campaign.plainContent = plainContent;
  if (scheduledFor !== undefined) {
    campaign.scheduledFor = scheduledFor ? new Date(scheduledFor) : undefined;
    campaign.status = scheduledFor ? "scheduled" : "draft";
  }

  await campaign.save();
  res.json(ApiResponse.ok({ campaign }, "Campaign updated"));
});

// DELETE /api/admin/newsletter/campaigns/:id
const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await NewsletterCampaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound("Campaign not found");
  if (campaign.status === "sending") {
    throw ApiError.conflict("Cannot delete a campaign that is currently sending");
  }
  await campaign.deleteOne();
  res.json(ApiResponse.ok(null, "Campaign deleted"));
});

// POST /api/admin/newsletter/campaigns/:id/send
// Sends asynchronously and returns immediately. Caller polls campaign status.
const sendCampaign = asyncHandler(async (req, res) => {
  const campaign = await NewsletterCampaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound("Campaign not found");
  if (campaign.status === "sending") {
    throw ApiError.conflict("Campaign is already sending");
  }
  if (campaign.status === "sent") {
    throw ApiError.conflict("Campaign has already been sent");
  }

  // Atomically transition status to "sending" with a guard to prevent
  // concurrent send-double-clicks from both starting background jobs.
  const locked = await NewsletterCampaign.findOneAndUpdate(
    {
      _id: campaign._id,
      status: { $in: ["draft", "scheduled", "failed"] },
    },
    {
      $set: {
        status: "sending",
        successCount: 0,
        failureCount: 0,
        failedRecipients: [],
      },
    },
    { new: true }
  );

  if (!locked) {
    throw ApiError.conflict(
      "Campaign cannot be sent in its current state. Refresh and try again."
    );
  }

  const subscribers = await Newsletter.find({ isActive: true })
    .select("email unsubscribeToken")
    .lean();

  if (subscribers.length === 0) {
    // Roll back the lock
    locked.status = "draft";
    await locked.save();
    throw ApiError.badRequest("No active subscribers");
  }

  locked.recipientCount = subscribers.length;
  await locked.save();

  // Fire and forget — process in background. Note: progress is lost on
  // server restart; the startup hook will mark stuck campaigns as failed.
  (async () => {
    try {
      const results = await sendBulkNewsletter(
        locked.subject,
        locked.htmlContent,
        subscribers
      );
      locked.successCount = results.sent;
      locked.failureCount = results.failed;
      locked.failedRecipients = results.errors;
      locked.status = results.failed === subscribers.length ? "failed" : "sent";
      locked.sentAt = new Date();
      await locked.save();
    } catch (err) {
      console.error("Campaign send error:", err.message);
      locked.status = "failed";
      await locked.save();
    }
  })();

  res.json(
    ApiResponse.ok(
      { campaign: locked, recipientCount: subscribers.length },
      "Campaign send started"
    )
  );
});

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
};
