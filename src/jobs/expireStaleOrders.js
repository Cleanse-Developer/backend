const agenda = require("../config/agenda");
const Order = require("../models/Order");
const { cancelCodOrder } = require("../services/order.service");

// COD orders awaiting WhatsApp confirmation auto-cancel after this window.
const COD_HOLD_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Sweep stale orders. Currently: COD orders still "awaiting" the customer's
 * WhatsApp confirmation older than 48h → auto-cancel + release stock (via
 * cancelCodOrder, which is idempotent and reverses stock/coupons/points).
 *
 * Scans broadly but only cancels this safe category. Paid prepaid orders are
 * never touched. Extend the query here to deal with other stale categories.
 */
agenda.define("expire-stale-orders", async () => {
  const cutoff = new Date(Date.now() - COD_HOLD_TTL_MS);

  const stale = await Order.find({
    "payment.method": "cod",
    "codConfirmation.status": "awaiting",
    status: "pending",
    createdAt: { $lt: cutoff },
  });

  if (stale.length === 0) return;
  console.log(`[expire-stale-orders] cancelling ${stale.length} unconfirmed COD order(s)`);

  for (const order of stale) {
    try {
      await cancelCodOrder(order, "Auto-expired: no WhatsApp confirmation within 48h");
      console.log(`[expire-stale-orders] expired ${order.orderId}`);
    } catch (err) {
      console.error(`[expire-stale-orders] failed for ${order.orderId}:`, err.message);
    }
  }
});
