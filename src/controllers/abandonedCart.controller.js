const Cart = require("../models/Cart");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

// Fields needed to render an abandoned-cart line in recovery jobs / dashboards.
const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag",
};

// User contact details for recovery outreach.
const POPULATE_USER = {
  path: "user",
  select: "fullName email phone",
};

/**
 * GET /api/public/abandoned-carts  (PUBLIC — no auth)
 *
 * A cart is "abandoned" when it still holds >=1 item and has not been touched
 * (updatedAt) for at least `staleMinutes`. Returns the total abandoned count plus
 * each cart's item list.
 *
 * Query params (all optional):
 *   staleMinutes  minutes of inactivity before abandoned  (default 30)
 *   userId        narrow to a single user's cart
 *   limit         page size, max 100                        (default 50)
 *   offset        skip N carts                              (default 0)
 */
const listAbandonedCarts = asyncHandler(async (req, res) => {
  const staleMinutes = Number(req.query.staleMinutes) || 30;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);

  const filter = {
    "items.0": { $exists: true }, // non-empty cart
    updatedAt: { $lt: staleBefore }, // stale
  };
  if (req.query.userId) filter.user = req.query.userId;

  // count = total abandoned carts matching, independent of pagination.
  const [count, carts] = await Promise.all([
    Cart.countDocuments(filter),
    Cart.find(filter)
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .populate(POPULATE_USER)
      .populate(POPULATE_PRODUCT)
      .lean(),
  ]);

  const data = carts.map((c) => ({
    _id: c._id,
    user: c.user,
    itemCount: c.items.length,
    totalUnits: c.items.reduce((sum, i) => sum + (i.quantity || 0), 0),
    items: c.items,
    giftWrap: c.giftWrap,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  }));

  res.json(
    ApiResponse.ok({ count, staleMinutes, limit, offset, carts: data })
  );
});

module.exports = { listAbandonedCarts };
