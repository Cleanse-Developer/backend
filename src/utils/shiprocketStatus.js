// Shiprocket shipment_status_id → our order status. Codes are from the official
// status table (apidocs.shiprocket.in). Only the ids we act on are mapped; any
// id not here is stored raw and logged.
//
// `kind` groups the downstream branch the webhook handler should take.

const STATUS_MAP = {
  // forward chain
  4: { status: "shipped", kind: "forward" }, // Pickup Scheduled
  70: { status: "shipped", kind: "forward" }, // Pickup Booked
  6: { status: "shipped", kind: "forward" }, // Shipped
  51: { status: "shipped", kind: "forward" }, // Picked Up
  42: { status: "shipped", kind: "forward" }, // Picked Up (alt)
  20: { status: "in_transit", kind: "forward" }, // In Transit
  43: { status: "in_transit", kind: "forward" }, // Reached Destination Hub
  44: { status: "in_transit", kind: "forward" }, // Misrouted
  37: { status: "in_transit", kind: "forward" }, // Delivery Delayed
  58: { status: "in_transit", kind: "forward" }, // Reached Warehouse
  19: { status: "out_for_delivery", kind: "forward" }, // Out for Delivery
  7: { status: "delivered", kind: "delivered" }, // Delivered
  38: { status: "delivered", kind: "delivered" }, // Partial Delivered

  // cancellation
  5: { status: "cancelled", kind: "cancelled" }, // Canceled
  54: { status: "cancelled", kind: "cancelled" }, // Canceled before Dispatched

  // NDR
  36: { status: null, kind: "ndr" }, // Undelivered

  // RTO
  15: { status: "rto_in_transit", kind: "rto" }, // RTO Initiated
  55: { status: "rto_in_transit", kind: "rto" }, // RTO In-Transit
  45: { status: "rto_in_transit", kind: "rto" }, // RTO_OFD
  46: { status: "rto_in_transit", kind: "rto" }, // RTO_NDR
  17: { status: "rto_in_transit", kind: "rto" }, // RTO Acknowledged
  16: { status: "rto_delivered", kind: "rto_delivered" }, // RTO Delivered

  // lost / damaged
  33: { status: null, kind: "exception" }, // Lost
  40: { status: null, kind: "exception" }, // Damaged
  39: { status: null, kind: "exception" }, // Destroyed
  53: { status: null, kind: "exception" }, // Disposed Off

  // customer return (reverse pickup) leg
  22: { status: null, kind: "return" }, // Return Initiated
  25: { status: null, kind: "return" }, // Return In Transit
  32: { status: null, kind: "return" }, // Return Picked Up
  9: { status: null, kind: "return" }, // Returned
  26: { status: "returned", kind: "return_delivered" }, // Return Delivered
};

// Monotonic rank of the forward lifecycle. Used to reject out-of-order events
// (e.g. an "in_transit" arriving after "delivered"). Terminal/branch states
// (cancelled, rto_*, return*, refund*) are handled separately, not ranked here.
const FORWARD_RANK = {
  pending: 0,
  confirmed: 1,
  processing: 2,
  packed: 3,
  shipped: 4,
  in_transit: 5,
  out_for_delivery: 6,
  delivered: 7,
};

const TERMINAL = new Set([
  "cancelled",
  "refund_initiated",
  "refunded",
  "returned",
]);

const mapStatus = (statusId) => STATUS_MAP[Number(statusId)] || null;

/**
 * Should we advance `current` → `next` on the forward chain? Only when both are
 * ranked and next is strictly ahead. Prevents regressions from out-of-order
 * webhook delivery.
 */
const canAdvanceForward = (current, next) => {
  const c = FORWARD_RANK[current];
  const n = FORWARD_RANK[next];
  if (n === undefined) return false;
  if (c === undefined) return true;
  return n > c;
};

module.exports = { STATUS_MAP, FORWARD_RANK, TERMINAL, mapStatus, canAdvanceForward };
