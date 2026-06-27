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
    // Globally-unique dedup key. For Razorpay it is the x-razorpay-event-id; for
    // Shiprocket (which sends no event id) it is a synthetic key namespaced per
    // source, e.g. `sr:<awb>:<statusId>:<timestamp>`.
    eventId: { type: String, required: true, unique: true },
    source: { type: String, default: "razorpay" },
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
