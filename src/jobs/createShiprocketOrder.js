const agenda = require("../config/agenda");
const Order = require("../models/Order");
const { createShipment } = require("../services/shiprocket.service");

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create an adhoc Shiprocket order (no AWB, no charge) for a freshly-placed
 * order, so it is queued in the Shiprocket panel immediately. AWB / pickup /
 * label still happen later at the "shipped" transition.
 *
 * Idempotent: skips if the order already has a shiprocketOrderId. On a
 * transient Shiprocket failure it reschedules itself with backoff up to
 * MAX_ATTEMPTS, so a Shiprocket outage never blocks or corrupts checkout.
 */
agenda.define("create-shiprocket-order", async (job) => {
  const { orderId, attempt = 1 } = job.attrs.data;

  const order = await Order.findById(orderId);
  if (!order) return; // order deleted — permanent no-op

  // Idempotency: already created (here, or by the "shipped" pipeline).
  if (order.shipping?.shiprocketOrderId) return;

  try {
    const res = await createShipment(order);
    order.shipping = order.shipping || {};
    order.shipping.shiprocketOrderId = String(res.order_id ?? "");
    order.shipping.shipmentId = String(res.shipment_id ?? "");
    order.adminNotes.push({
      note: `Shiprocket order queued (id ${order.shipping.shiprocketOrderId}, shipment ${order.shipping.shipmentId})`,
      addedAt: new Date(),
    });
    await order.save();
  } catch (err) {
    console.error(
      `create-shiprocket-order failed for ${order.orderId} (attempt ${attempt}):`,
      err.message
    );
    if (attempt < MAX_ATTEMPTS) {
      await agenda.schedule(new Date(Date.now() + RETRY_DELAY_MS), "create-shiprocket-order", {
        orderId,
        attempt: attempt + 1,
      });
    } else {
      order.adminNotes.push({
        note: `Shiprocket order creation failed after ${MAX_ATTEMPTS} attempts: ${err.message}. Use "Sync" in the Shipment tab to retry.`,
        addedAt: new Date(),
      });
      await order.save();
    }
  }
});

/**
 * Queue an adhoc Shiprocket order creation for an order. Fire-and-forget from
 * the order-creation paths — never blocks or fails checkout.
 */
const scheduleShiprocketCreate = async (orderId) => {
  try {
    await agenda.now("create-shiprocket-order", { orderId: String(orderId) });
  } catch (err) {
    console.error("Failed to schedule create-shiprocket-order:", err.message);
  }
};

module.exports = { scheduleShiprocketCreate };
