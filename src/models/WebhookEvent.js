const mongoose = require("mongoose");

/**
 * Records every Razorpay webhook event we have processed, keyed on the
 * `x-razorpay-event-id` header. Used to make webhook handling idempotent:
 * Razorpay retries and may deliver duplicates, so we insert the event id
 * atomically and short-circuit any event we have already seen.
 *
 * Records auto-expire after 30 days (TTL index) to bound collection growth.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    event: { type: String },
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// TTL: purge records 30 days after they are processed.
webhookEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
