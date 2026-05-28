const mongoose = require("mongoose");

const newsletterCampaignSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, maxlength: 200 },
    htmlContent: { type: String, required: true },
    plainContent: { type: String },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "failed"],
      default: "draft",
    },
    scheduledFor: { type: Date },
    sentAt: { type: Date },
    recipientCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    failedRecipients: [
      {
        email: String,
        error: String,
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

newsletterCampaignSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("NewsletterCampaign", newsletterCampaignSchema);
