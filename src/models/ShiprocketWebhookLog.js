const mongoose = require("mongoose");

/**
 * Raw audit trail of EVERY inbound Shiprocket tracking webhook call — captured
 * regardless of outcome (processed / duplicate / unknown order / unauthorized /
 * bad request / error). Lets us reconstruct exactly what Shiprocket sent and
 * what our system did, especially when processing fails.
 *
 * Extracted fields (awb, statuses, ids, matchedOrder) are denormalized for
 * querying; the complete body is kept in `payload`. The x-api-key token is
 * deliberately NOT stored.
 */
const schema = new mongoose.Schema(
  {
    receivedAt: { type: Date, default: Date.now },

    // Auth / outcome
    authorized: { type: Boolean, default: false },
    result: {
      type: String,
      enum: ["processed", "duplicate", "unknown_order", "unauthorized", "bad_request", "error"],
      required: true,
    },
    responseCode: { type: Number },
    error: { type: String },

    // Extracted (for querying)
    awb: { type: String },
    currentStatus: { type: String },
    currentStatusId: { type: Number },
    shipmentStatus: { type: String },
    shipmentStatusId: { type: Number },
    srOrderId: { type: String },
    channelOrderId: { type: String },

    // Linkage to our order (set when matched)
    matchedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderId: { type: String },
    isReturnLeg: { type: Boolean, default: false },
    appliedStatus: { type: String }, // order.status after processing

    ip: { type: String },
    // Full raw payload + selected (non-sensitive) headers for forensic review.
    payload: { type: mongoose.Schema.Types.Mixed },
    headers: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Group/fetch by order, newest first.
schema.index({ matchedOrder: 1, receivedAt: -1 });
schema.index({ awb: 1, receivedAt: -1 });
schema.index({ result: 1, receivedAt: -1 });
// Bound growth: keep 1 year, then auto-purge (adjust if longer retention needed).
schema.index({ receivedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model("ShiprocketWebhookLog", schema);
