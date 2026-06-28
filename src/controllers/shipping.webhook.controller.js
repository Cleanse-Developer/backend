const crypto = require("crypto");
const Order = require("../models/Order");
const WebhookEvent = require("../models/WebhookEvent");
const ShiprocketWebhookLog = require("../models/ShiprocketWebhookLog");
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
  const payload = req.body || {};
  const apiKey = req.headers["x-api-key"];
  const expectedToken = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  const authorized = !!expectedToken && constantTimeEqual(apiKey, expectedToken);
  // Map on current_status_id (canonical status table); shipment_status_id is a
  // different enum, used only as fallback.
  const statusId = payload.current_status_id ?? payload.shipment_status_id;

  // Audit record — populated as we go, written once in `finally` (best-effort,
  // never blocks the response). Captures the FULL payload for forensic review.
  const record = {
    receivedAt: new Date(),
    authorized,
    awb: payload.awb,
    currentStatus: payload.current_status,
    currentStatusId: payload.current_status_id,
    shipmentStatus: payload.shipment_status,
    shipmentStatusId: payload.shipment_status_id,
    srOrderId: payload.sr_order_id != null ? String(payload.sr_order_id) : undefined,
    channelOrderId: payload.order_id != null ? String(payload.order_id) : undefined,
    ip: req.headers["x-forwarded-for"] || req.ip,
    payload,
    headers: {
      "content-type": req.headers["content-type"],
      "user-agent": req.headers["user-agent"],
    },
  };
  let code = 200;
  let result = "processed";

  try {
    if (!authorized) {
      result = "unauthorized";
      code = 401;
      return res.status(code).json({ error: "Invalid api key" });
    }
    if (!payload.awb || statusId === undefined || statusId === null) {
      result = "bad_request";
      code = 400;
      return res.status(code).json({ error: "Missing awb or status id" });
    }

    console.log(
      `[ShiprocketWebhook] AWB ${payload.awb}, status ${payload.current_status || payload.shipment_status} (${statusId}), order ${payload.order_id || payload.sr_order_id || "?"}`
    );

    // Idempotency: synthesize an event id (Shiprocket sends none).
    const eventId = `sr:${payload.awb}:${statusId}:${payload.current_timestamp || ""}`;
    if (await WebhookEvent.exists({ eventId })) {
      result = "duplicate";
      return res.status(200).json({ status: "ok", duplicate: true });
    }

    // Resolve order by AWB (forward or return leg), fallback by sr_order_id.
    let order = await Order.findOne({
      $or: [
        { "shipping.awbNumber": payload.awb },
        { "shipping.returnShipment.awbNumber": payload.awb },
      ],
    });
    if (!order && payload.sr_order_id) {
      order = await Order.findOne({ "shipping.shiprocketOrderId": String(payload.sr_order_id) });
    }

    if (!order) {
      console.warn(`[ShiprocketWebhook] No order for AWB ${payload.awb}`);
      result = "unknown_order";
      return res.status(200).json({ status: "ok", unknown: true });
    }

    const isReturnLeg = order.shipping?.returnShipment?.awbNumber === payload.awb;
    record.matchedOrder = order._id;
    record.orderId = order.orderId;
    record.isReturnLeg = isReturnLeg;

    try {
      await applyEvent(order, payload, statusId, isReturnLeg);
    } catch (err) {
      console.error(`[ShiprocketWebhook] processing error (AWB ${payload.awb}):`, err.message);
      result = "error";
      record.error = err.message;
      code = 500;
      return res.status(code).json({ error: "Processing failed" });
    }

    record.appliedStatus = order.status;

    try {
      await WebhookEvent.create({ eventId, source: "shiprocket", event: String(statusId) });
    } catch (err) {
      if (err.code !== 11000) console.error("Shiprocket dedup record error:", err.message);
    }

    result = "processed";
    return res.status(200).json({ status: "ok" });
  } finally {
    record.result = result;
    record.responseCode = code;
    try {
      await ShiprocketWebhookLog.create(record);
    } catch (e) {
      console.error("Shiprocket webhook log write failed:", e.message);
    }
  }
};

module.exports = { handleShiprocketTracking };
