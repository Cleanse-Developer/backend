const crypto = require("crypto");
const Order = require("../models/Order");
const WebhookEvent = require("../models/WebhookEvent");
const { mapStatus, canAdvanceForward, TERMINAL } = require("../utils/shiprocketStatus");
const { ndrAction } = require("../services/shiprocket.service");
const { processOrderRefund, restockOrder } = require("../services/refund.service");
const { sendEmail } = require("../services/email.service");

const NDR_MAX = () => Number(process.env.SHIPROCKET_NDR_MAX_REATTEMPTS) || 2;

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
      return; // processOrderRefund already restocks on a full refund
    } catch (err) {
      order.adminNotes.push({
        note: `Auto-refund failed (${reason}): ${err.message}`,
        addedAt: new Date(),
      });
    }
  }
  try {
    await restockOrder(order);
  } catch (err) {
    order.adminNotes.push({
      note: `Restock failed (${reason}): ${err.message}`,
      addedAt: new Date(),
    });
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

  const mapping = mapStatus(statusId);
  if (!mapping) {
    order.adminNotes.push({
      note: `Shiprocket tracking: unmapped status "${order.shipping.lastTrackingStatus}" (id ${statusId})`,
      addedAt: new Date(),
    });
    await order.save();
    return;
  }

  switch (mapping.kind) {
    case "forward": {
      if (canAdvanceForward(order.status, mapping.status)) {
        order.status = mapping.status;
      }
      break;
    }

    case "delivered": {
      if (!TERMINAL.has(order.status) && order.status !== "delivered") {
        order.status = "delivered";
        order.deliveredAt = new Date();
      }
      // COD: cash collected on delivery → mark paid.
      if (order.payment.method === "cod" && order.payment.status !== "paid") {
        order.payment.status = "paid";
      }
      break;
    }

    case "cancelled": {
      if (!TERMINAL.has(order.status) && order.status !== "delivered") {
        order.status = "cancelled";
        order.cancelledAt = new Date();
      }
      break;
    }

    case "ndr": {
      order.shipping.ndrAttempts = (order.shipping.ndrAttempts || 0) + 1;
      const action = order.shipping.ndrAttempts <= NDR_MAX() ? "re-attempt" : "return";
      try {
        await ndrAction(awb, action, `Auto ${action} (NDR attempt ${order.shipping.ndrAttempts})`);
        order.adminNotes.push({
          note: `NDR attempt ${order.shipping.ndrAttempts}: ${action} requested`,
          addedAt: new Date(),
        });
      } catch (err) {
        order.adminNotes.push({
          note: `NDR ${action} failed: ${err.message}`,
          addedAt: new Date(),
        });
      }
      break;
    }

    case "rto": {
      order.shipping.isRTO = true;
      if (!TERMINAL.has(order.status) && order.status !== "rto_delivered") {
        order.status = "rto_in_transit";
      }
      break;
    }

    case "rto_delivered": {
      order.shipping.isRTO = true;
      order.status = "rto_delivered";
      await restockAndMaybeRefund(order, `RTO delivered for ${order.orderId}`);
      break;
    }

    case "return": {
      // Reverse-pickup leg in progress — record only.
      order.adminNotes.push({
        note: `Return shipment update: ${order.shipping.lastTrackingStatus}`,
        addedAt: new Date(),
      });
      break;
    }

    case "return_delivered": {
      order.status = "returned";
      if (order.returnRequest) order.returnRequest.status = "completed";
      await restockAndMaybeRefund(order, `Return delivered for ${order.orderId}`);
      break;
    }

    case "exception": {
      order.adminNotes.push({
        note: `Shipment exception: ${order.shipping.lastTrackingStatus} (id ${statusId}) — manual review needed`,
        addedAt: new Date(),
      });
      try {
        if (process.env.ADMIN_NOTIFY_EMAIL) {
          await sendEmail({
            to: process.env.ADMIN_NOTIFY_EMAIL,
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
