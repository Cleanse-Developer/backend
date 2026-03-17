const Order = require("../models/Order");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

// Cache raw order data, NOT the formatted output (relative times go stale otherwise)
let cachedOrders = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getRelativeTime(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;

  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatPurchases(rawOrders, limit) {
  return rawOrders.slice(0, limit).map((entry) => ({
    name: entry.firstName,
    location: entry.city,
    product: entry.productName,
    time: getRelativeTime(entry.createdAt),
  }));
}

async function fetchRawOrders() {
  // Try last 48 hours first
  let since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  let orders = await Order.find({
    status: { $in: ["confirmed", "processing", "packed", "shipped", "delivered"] },
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("shippingAddress.fullName shippingAddress.city items.name createdAt")
    .lean();

  // Fallback: if no recent orders, widen to last 30 days
  if (orders.length === 0) {
    since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    orders = await Order.find({
      status: { $in: ["confirmed", "processing", "packed", "shipped", "delivered"] },
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("shippingAddress.fullName shippingAddress.city items.name createdAt")
      .lean();
  }

  // Flatten to one entry per order (first item only for privacy)
  return orders.flatMap((order) => {
    const fullName = order.shippingAddress?.fullName || "Someone";
    const firstName = fullName.split(" ")[0];
    const city = order.shippingAddress?.city || "India";

    return (order.items || []).slice(0, 1).map((item) => ({
      firstName,
      city,
      productName: item.name,
      createdAt: order.createdAt,
    }));
  }).slice(0, 20);
}

// GET /api/social-proof/recent-purchases
const getRecentPurchases = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));

  if (!cachedOrders || Date.now() >= cacheExpiresAt) {
    cachedOrders = await fetchRawOrders();
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }

  // Relative times are computed fresh on every request from cached raw timestamps
  const purchases = formatPurchases(cachedOrders, limit);

  res.json(ApiResponse.ok({ purchases }));
});

module.exports = { getRecentPurchases };
