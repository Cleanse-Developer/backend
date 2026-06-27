const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "rto_in_transit",
  "rto_delivered",
  "return_requested",
  "return_approved",
  "returned",
  "refund_initiated",
  "refunded",
];

const PAYMENT_METHODS = ["razorpay", "cod", "upi"];

const PAYMENT_STATUSES = ["pending", "paid", "failed", "refund_initiated", "refunded", "partially_refunded"];

const ROLES = {
  CUSTOMER: "customer",
  ADMIN: "admin",
  MANAGER: "manager",
  SUPPORT: "support",
};

const PRODUCT_TAGS = ["Face Care", "Hair Care", "Body Care"];

const DISCOUNT_TIERS = [
  { threshold: 3500, percent: 15, label: "15% OFF" },
  { threshold: 2000, percent: 10, label: "10% OFF" },
  { threshold: 500, percent: 5, label: "5% OFF" },
];

const SHIPPING = {
  FREE_THRESHOLD: 1200,
  STANDARD_RATE: 99,
};

const GIFT_WRAP_COST = 99;

const LOYALTY_RATE = 0.1; // 1 point per ₹10

const REFERRAL_REWARD = 200; // ₹200

const PAYMENT_SESSION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "expired",
  "failed",
];

const SESSION_TTL_MINUTES = 30;

module.exports = {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ROLES,
  PRODUCT_TAGS,
  DISCOUNT_TIERS,
  SHIPPING,
  GIFT_WRAP_COST,
  LOYALTY_RATE,
  REFERRAL_REWARD,
  PAYMENT_SESSION_STATUSES,
  SESSION_TTL_MINUTES,
};
