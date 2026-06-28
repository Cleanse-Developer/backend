const crypto = require("crypto");
const Order = require("../models/Order");
const WebhookEvent = require("../models/WebhookEvent");
const { mapStatus, canAdvanceForward, TERMINAL } = require("../utils/shiprocketStatus");
const { ndrAction } = require("../services/shiprocket.service");
const { processOrderRefund, restockOrder } = require("../services/refund.service");
const { sendEmail } = require("../services/email.service");
const { getConfig } = require("../utils/shiprocketConfig");
const { logActivity, ACTORS } = require("../utils/orderActivity");

// Plain-language label for a courier status to show in the activity feed.
const plainStatus = (s) => (s || "update").toString().toLowerCase();

const constantTimeEqual = (a, b) => {
  const ab = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const isPrepaidPaid = (order) =>
  order.payment.method === "razorpay" &&
  ["paid", "partially_refunded"].includes(order.payment.status);

// Restock + (prepaid) auto-refund. Best-effort; never throws.
const restockAndMaybeRefund = async (order, reason) => {
  if (isPrepaidPaid(order)) {
    try {
      await processOrderRefund(order, { reason, initiatedBy: null });
      logActivity(order, { actor: ACTORS.SYSTEM, event: "refund:auto", note: "Stock restored and refund issued automatically" });
      return; // processOrderRefund already restocks on a full refund
    } catch (err) {
      logActivity(order, { actor: ACTORS.SYSTEM, event: "refund:failed", note: `Auto-refund failed: ${err.message}` });
    }
  }
  try {
    await restockOrder(order);
    logActivity(order, { actor: ACTORS.SYSTEM, event: "restock", note: "Stock restored" });
  } catch (err) {
    logActivity(order, { actor: ACTORS.SYSTEM, event: "restock:failed", note: `Restock failed: ${err.message}` });
  }
};

/**
 * Apply a single (verified, de-duplicated) Shiprocket tracking event to an
 * order. Mutates and saves the order. Throws only on transient DB failures so
 * the caller can respond 5xx and Shiprocket retries; all external side-effects
 * (NDR action, refund) are best-effort and swallowed.
 */
const applyEvent = async (order, payload, statusId, isReturnLeg) => {
  const awb = payload.awb;
  order.shipping = order.shipping || {};

  // Always record the raw tracking state.
  order.shipping.lastTrackingStatus = payload.current_status || payload.shipment_status;
  order.shipping.lastTrackingStatusId = Number(statusId);
  order.shipping.lastWebhookAt = new Date();
  if (payload.etd) {
    const etd = new Date(payload.etd);
    if (!isNaN(etd)) order.shipping.estimatedDelivery = etd;
  }

  const cfg = await getConfig();

  const mapping = mapStatus(statusId);
  if (!mapping) {
    logActivity(order, {
      actor: ACTORS.COURIER,
      event: "tracking:other",
      note: `Courier update: ${plainStatus(order.shipping.lastTrackingStatus)}`,
    });
    await order.save();
    return;
  }

  const courierLabel = plainStatus(order.shipping.lastTrackingStatus);

  switch (mapping.kind) {
    case "forward": {
      if (canAdvanceForward(order.status, mapping.status)) {
        order.status = mapping.status;
        logActivity(order, {
          actor: ACTORS.COURIER,
          event: `tracking:${mapping.status}`,
          note: `Courier update: ${courierLabel}`,
        });
      }
      break;
    }

    case "delivered": {
      if (!TERMINAL.has(order.status) && order.status !== "delivered") {
        order.status = "delivered";
        order.deliveredAt = new Date();
        logActivity(order, { actor: ACTORS.COURIER, event: "tracking:delivered", note: "Delivered to customer" });
      }
      // COD: cash collected on delivery → mark paid.
      if (order.payment.method === "cod" && order.payment.status !== "paid") {
        order.payment.status = "paid";
        logActivity(order, { actor: ACTORS.SYSTEM, event: "payment:paid", note: "COD cash collected — payment marked paid" });
      }
      break;
    }

    case "cancelled": {
      if (!TERMINAL.has(order.status) && order.status !== "delivered") {
        order.status = "cancelled";
        order.cancelledAt = new Date();
        logActivity(order, { actor: ACTORS.COURIER, event: "tracking:cancelled", note: "Shipment cancelled by courier" });
      }
      break;
    }

    case "ndr": {
      order.shipping.ndrAttempts = (order.shipping.ndrAttempts || 0) + 1;
      const action = order.shipping.ndrAttempts <= cfg.ndrMaxReattempts ? "re-attempt" : "return";
      logActivity(order, { actor: ACTORS.COURIER, event: "tracking:ndr", note: `Delivery failed (attempt ${order.shipping.ndrAttempts})` });
      try {
        await ndrAction(awb, action, `Auto ${action} (NDR attempt ${order.shipping.ndrAttempts})`);
        logActivity(order, {
          actor: ACTORS.SYSTEM,
          event: `ndr:${action}`,
          note: action === "return" ? "Asked courier to return the parcel (max retries reached)" : "Asked courier to re-attempt delivery",
        });
      } catch (err) {
        logActivity(order, { actor: ACTORS.SYSTEM, event: "ndr:failed", note: `Auto ${action} failed: ${err.message}` });
      }
      break;
    }

    case "rto": {
      order.shipping.isRTO = true;
      if (!TERMINAL.has(order.status) && order.status !== "rto_delivered") {
        order.status = "rto_in_transit";
        logActivity(order, { actor: ACTORS.COURIER, event: "tracking:rto", note: "Parcel is coming back to us (return to origin)" });
      }
      break;
    }

    case "rto_delivered": {
      order.shipping.isRTO = true;
      order.status = "rto_delivered";
      logActivity(order, { actor: ACTORS.COURIER, event: "tracking:rto_delivered", note: "Returned parcel is back at the warehouse" });
      await restockAndMaybeRefund(order, `RTO delivered for ${order.orderId}`);
      break;
    }

    case "return": {
      // Reverse-pickup leg in progress — record only.
      logActivity(order, { actor: ACTORS.COURIER, event: "tracking:return", note: `Return shipment update: ${courierLabel}` });
      break;
    }

    case "return_delivered": {
      order.status = "returned";
      if (order.returnRequest) order.returnRequest.status = "completed";
      logActivity(order, { actor: ACTORS.COURIER, event: "tracking:returned", note: "Returned item received back" });
      await restockAndMaybeRefund(order, `Return delivered for ${order.orderId}`);
      break;
    }

    case "exception": {
      logActivity(order, {
        actor: ACTORS.COURIER,
        event: "tracking:exception",
        note: `Problem reported: ${courierLabel} — needs manual review`,
      });
      try {
        if (cfg.adminNotifyEmail) {
          await sendEmail({
            to: cfg.adminNotifyEmail,
            subject: `Shipment exception — ${order.orderId}`,
            html: `<p>Order <strong>${order.orderId}</strong> (AWB ${awb}) reported status <strong>${order.shipping.lastTrackingStatus}</strong>. File a claim / refund manually.</p>`,
          });
        }
      } catch (err) {
        console.error("Exception notify email failed:", err.message);
      }
      break;
    }

    default:
      break;
  }

  await order.save();
};

/**
 * POST /api/shipping/tracking-callback
 * Shiprocket tracking webhook. Verify x-api-key → validate → dedup → apply →
 * record. Always returns 200 on handled/duplicate/unknown-awb; 401 on bad
 * token; 400 on malformed; 500 on transient failure (Shiprocket retries).
 */
const handleShiprocketTracking = async (req, res) => {
  const expectedToken = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  const apiKey = req.headers["x-api-key"];

  if (!expectedToken || !constantTimeEqual(apiKey, expectedToken)) {
    return res.status(401).json({ error: "Invalid api key" });
  }

  const payload = req.body || {};
  const awb = payload.awb;
  const statusId = payload.shipment_status_id ?? payload.current_status_id;

  if (!awb || statusId === undefined || statusId === null) {
    return res.status(400).json({ error: "Missing awb or status id" });
  }

  console.log(
    `[ShiprocketWebhook] AWB ${awb}, status ${payload.current_status || payload.shipment_status} (${statusId}), order ${payload.order_id || payload.sr_order_id || "?"}`
  );

  // Idempotency: Shiprocket sends no event id, so synthesize one. Retries of the
  // same event share the key and short-circuit.
  const eventId = `sr:${awb}:${statusId}:${payload.current_timestamp || ""}`;
  if (await WebhookEvent.exists({ eventId })) {
    return res.status(200).json({ status: "ok", duplicate: true });
  }

  // Resolve the order: by AWB (forward or return leg), fallback by sr_order_id.
  let order = await Order.findOne({
    $or: [
      { "shipping.awbNumber": awb },
      { "shipping.returnShipment.awbNumber": awb },
    ],
  });
  if (!order && payload.sr_order_id) {
    order = await Order.findOne({
      "shipping.shiprocketOrderId": String(payload.sr_order_id),
    });
  }

  if (!order) {
    // Unknown shipment — ack so Shiprocket stops retrying, but log it.
    console.warn(`[ShiprocketWebhook] No order for AWB ${awb}`);
    return res.status(200).json({ status: "ok", unknown: true });
  }

  const isReturnLeg = order.shipping?.returnShipment?.awbNumber === awb;

  try {
    await applyEvent(order, payload, statusId, isReturnLeg);
  } catch (err) {
    console.error(`[ShiprocketWebhook] processing error (AWB ${awb}):`, err.message);
    return res.status(500).json({ error: "Processing failed" });
  }

  // Record only after success so a transient failure reprocesses cleanly.
  try {
    await WebhookEvent.create({ eventId, source: "shiprocket", event: String(statusId) });
  } catch (err) {
    if (err.code !== 11000) console.error("Shiprocket dedup record error:", err.message);
  }

  return res.status(200).json({ status: "ok" });
};

module.exports = { handleShiprocketTracking };
