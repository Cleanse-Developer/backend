const env = require("../config/env");
const { sendTemplate } = require("../config/whatsapp");
const { extractLocalNumber } = require("../utils/phoneUtils");

/**
 * High-level WhatsApp messaging for order events. Wraps the slide client with
 * template-specific payload builders. All senders are best-effort: callers wrap
 * them in try/catch and must never let a messaging failure break order flow.
 */

const LANG = env.WHATSAPP_TEMPLATE_LANG;

/**
 * Build the slide `to` field: E.164 digits, no leading "+".
 * Orders store the local number in `shippingAddress.phone` and the dialling
 * code (e.g. "+91") separately in `countryCode`.
 */
const toWhatsAppNumber = (order) => {
  const addr = order.shippingAddress || {};
  const cc = String(addr.countryCode || "+91").replace(/\D/g, "");
  const local = extractLocalNumber(addr.phone || order.contactPhone || "");
  return `${cc}${local}`;
};

/**
 * Summarise order items into a single template variable (no newlines/tabs —
 * WhatsApp rejects those inside one parameter). Caps to the first two names and
 * appends "+N more" so long carts stay short.
 */
const itemsSummary = (order) => {
  const names = (order.items || [])
    .filter((i) => !i.isFreeGift)
    .map((i) => i.name);
  if (names.length === 0) return "your items";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
};

const bodyComponent = (texts) => ({
  type: "body",
  parameters: texts.map((t) => ({ type: "text", text: String(t) })),
});

const customerName = (order) =>
  (order.shippingAddress?.fullName || "there").split(" ")[0] || "there";

const deliveryEstimate = (order) => {
  const etd = order.shipping?.estimatedDelivery;
  if (etd) {
    const d = new Date(etd);
    if (!isNaN(d)) {
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  return "3-5 business days";
};

/**
 * COD confirmation request (template order_confirmation_2).
 * Body vars: {{1}} name, {{2}} orderId, {{3}} items, {{4}} amount.
 * Returns slide response { wamid, conversationId, status }.
 */
const sendOrderConfirmation = (order) =>
  sendTemplate({
    to: toWhatsAppNumber(order),
    templateName: env.WHATSAPP_TPL_ORDER_CONFIRM,
    languageCode: LANG,
    components: [
      bodyComponent([
        customerName(order),
        order.orderId,
        itemsSummary(order),
        order.pricing.total,
      ]),
    ],
  });

/**
 * Order summary (template order_summary_1).
 * Body vars: {{1}} name, {{2}} orderId, {{3}} items, {{4}} total, {{5}} delivery.
 */
const sendOrderSummary = (order) =>
  sendTemplate({
    to: toWhatsAppNumber(order),
    templateName: env.WHATSAPP_TPL_ORDER_SUMMARY,
    languageCode: LANG,
    components: [
      bodyComponent([
        customerName(order),
        order.orderId,
        itemsSummary(order),
        order.pricing.total,
        deliveryEstimate(order),
      ]),
    ],
  });

module.exports = {
  toWhatsAppNumber,
  itemsSummary,
  sendOrderConfirmation,
  sendOrderSummary,
};
