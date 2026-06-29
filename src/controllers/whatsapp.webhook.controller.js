const crypto = require("crypto");
const Order = require("../models/Order");
const WebhookEvent = require("../models/WebhookEvent");
const { confirmCodOrder, cancelCodOrder } = require("../services/order.service");
const { extractLocalNumber } = require("../utils/phoneUtils");

const constantTimeEqual = (a, b) => {
  const ab = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/**
 * Normalise an inbound WhatsApp webhook into the one button-reply event we care
 * about: { messageId, from, contextWamid, buttonText }.
 *
 * ⚠ slide's exact payload is not documented yet, so this is defensive across the
 * common shapes (Meta Cloud API and flat BSP relays). When the real format is
 * known, finalise the extraction HERE only — the rest of the handler is generic.
 * Returns null if the payload isn't a button reply.
 */
const parseButtonReply = (body = {}) => {
  // Shape A — Meta Cloud API: entry[].changes[].value.messages[]
  const metaMsg =
    body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    body?.messages?.[0] ||
    body?.message ||
    body;

  if (!metaMsg) return null;

  const messageId = metaMsg.id || metaMsg.messageId || metaMsg.wamid || body.id;
  const from = metaMsg.from || metaMsg.sender || metaMsg.phone || body.from;
  const contextWamid =
    metaMsg.context?.id || metaMsg.context?.wamid || body.context?.id || null;

  // Quick-reply button: type "button" → { button: { text, payload } }
  // Interactive button: type "interactive" → { interactive: { button_reply: { title } } }
  const buttonText =
    metaMsg.button?.text ||
    metaMsg.button?.payload ||
    metaMsg.interactive?.button_reply?.title ||
    metaMsg.interactive?.button_reply?.id ||
    metaMsg.text?.body ||
    body.buttonText ||
    null;

  if (!buttonText) return null;
  return { messageId, from, contextWamid, buttonText };
};

const classifyReply = (text) => {
  const t = String(text).toLowerCase();
  if (t.includes("confirm")) return "confirm";
  if (t.includes("cancel")) return "cancel";
  return null;
};

/**
 * Resolve the held COD order an inbound reply belongs to: prefer the wamid of
 * the template message the customer replied to (context), else the most recent
 * "awaiting" COD order for that phone number.
 */
const resolveOrder = async ({ contextWamid, from }) => {
  if (contextWamid) {
    const byWamid = await Order.findOne({ "codConfirmation.wamid": contextWamid });
    if (byWamid) return byWamid;
  }
  if (from) {
    const local = extractLocalNumber(from);
    return Order.findOne({
      "codConfirmation.status": "awaiting",
      "payment.method": "cod",
      $or: [
        { "shippingAddress.phone": local },
        { contactPhone: local },
      ],
    }).sort({ createdAt: -1 });
  }
  return null;
};

/**
 * POST /api/whatsapp/webhook
 * slide inbound webhook for template button replies (Confirm/Cancel on COD).
 * Verify x-api-key → parse → dedup → resolve order → confirm/cancel.
 * 200 on handled/ignored/duplicate; 401 bad token; 500 on transient failure.
 */
const handleWhatsAppWebhook = async (req, res) => {
  const expected = process.env.WHATSAPP_WEBHOOK_TOKEN;
  const provided = req.headers["x-api-key"] || req.query.token;
  if (!expected || !constantTimeEqual(provided, expected)) {
    console.warn(`[WhatsAppWebhook] rejected — bad/missing token`, {
      hasHeader: Boolean(req.headers["x-api-key"]),
    });
    return res.status(401).json({ error: "Invalid token" });
  }

  console.log(`[WhatsAppWebhook] received`, { body: req.body });

  const reply = parseButtonReply(req.body);
  if (!reply) {
    // Not a button reply (status update, text message, etc.) — ack and ignore.
    console.log(`[WhatsAppWebhook] ignored — not a button reply`);
    return res.status(200).json({ status: "ignored" });
  }

  const action = classifyReply(reply.buttonText);
  console.log(`[WhatsAppWebhook] parsed`, {
    from: reply.from,
    buttonText: reply.buttonText,
    action,
  });
  if (!action) return res.status(200).json({ status: "ignored", reason: "unrecognised button" });

  // Idempotency: same inbound message may be retried.
  const eventId = `wa:${reply.messageId || `${reply.from}:${reply.buttonText}`}`;
  if (await WebhookEvent.exists({ eventId })) {
    console.log(`[WhatsAppWebhook] duplicate`, { eventId });
    return res.status(200).json({ status: "ok", duplicate: true });
  }

  const order = await resolveOrder(reply);
  if (!order) {
    console.warn(`[WhatsAppWebhook] no awaiting COD order for reply`, reply);
    return res.status(200).json({ status: "ok", unknown: true });
  }
  console.log(`[WhatsAppWebhook] resolved order ${order.orderId} → ${action}`);

  try {
    if (action === "confirm") await confirmCodOrder(order);
    else await cancelCodOrder(order, "Customer declined via WhatsApp");
  } catch (err) {
    console.error(`[WhatsAppWebhook] processing error for ${order.orderId}:`, err.message);
    return res.status(500).json({ error: "Processing failed" });
  }

  try {
    await WebhookEvent.create({ eventId, source: "whatsapp", event: action });
  } catch (err) {
    if (err.code !== 11000) console.error("WhatsApp dedup record error:", err.message);
  }

  return res.status(200).json({ status: "ok", action, orderId: order.orderId });
};

module.exports = { handleWhatsAppWebhook, parseButtonReply, classifyReply };
