const Order = require("../../models/Order");
const User = require("../../models/User");
const Product = require("../../models/Product");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");

// GET /api/admin/dashboard
const getOverview = asyncHandler(async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalOrders,
    revenueAgg,
    totalCustomers,
    ordersToday,
    revenueTodayAgg,
    recentOrders,
    lowStockProducts,
  ] = await Promise.all([
    // Total orders
    Order.countDocuments(),

    // Total revenue from paid orders
    Order.aggregate([
      { $match: { "payment.status": "paid" } },
      { $group: { _id: null, total: { $sum: "$pricing.total" } } },
    ]),

    // Total customers
    User.countDocuments({ role: "customer" }),

    // Orders today
    Order.countDocuments({ createdAt: { $gte: todayStart } }),

    // Revenue today from paid orders
    Order.aggregate([
      {
        $match: {
          "payment.status": "paid",
          createdAt: { $gte: todayStart },
        },
      },
      { $group: { _id: null, total: { $sum: "$pricing.total" } } },
    ]),

    // Recent orders (last 5)
    Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("user", "fullName email")
      .lean(),

    // Low stock products (totalStock < 10)
    Product.find({ totalStock: { $lt: 10 }, isActive: true })
      .sort({ totalStock: 1 })
      .limit(5)
      .select("name slug totalStock images")
      .lean(),
  ]);

  const totalRevenue =
    revenueAgg.length > 0 ? revenueAgg[0].total : 0;
  const revenueToday =
    revenueTodayAgg.length > 0 ? revenueTodayAgg[0].total : 0;
  const averageOrderValue =
    totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  res.json(
    ApiResponse.ok({
      totalOrders,
      totalRevenue,
      totalCustomers,
      averageOrderValue,
      ordersToday,
      revenueToday,
      recentOrders,
      lowStockProducts,
    })
  );
});

// GET /api/admin/dashboard/reports/sales
const getSalesReport = asyncHandler(async (req, res) => {
  const { dateFrom, dateTo, groupBy = "day" } = req.query;

  const match = { "payment.status": "paid" };

  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) match.createdAt.$lte = new Date(dateTo);
  }

  let dateFormat;
  if (groupBy === "week") {
    dateFormat = { $dateToString: { format: "%Y-W%V", date: "$createdAt" } };
  } else if (groupBy === "month") {
    dateFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  } else {
    dateFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
  }

  const salesData = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: dateFormat,
        orderCount: { $sum: 1 },
        revenue: { $sum: "$pricing.total" },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        date: "$_id",
        orderCount: 1,
        revenue: 1,
      },
    },
  ]);

  res.json(ApiResponse.ok(salesData));
});

// GET /api/admin/dashboard/reports/customers
const getCustomerReport = asyncHandler(async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [newCustomersThisMonth, returningCustomersAgg, topCustomersBySpend] =
    await Promise.all([
      // New customers this month
      User.countDocuments({
        role: "customer",
        createdAt: { $gte: monthStart },
      }),

      // Returning customers (users with more than 1 order)
      Order.aggregate([
        { $group: { _id: "$user", orderCount: { $sum: 1 } } },
        { $match: { orderCount: { $gt: 1 } } },
        { $count: "count" },
      ]),

      // Top 5 customers by spend
      Order.aggregate([
        { $match: { "payment.status": "paid" } },
        {
          $group: {
            _id: "$user",
            totalSpend: { $sum: "$pricing.total" },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { totalSpend: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $project: {
            _id: 0,
            userId: "$user._id",
            fullName: "$user.fullName",
            email: "$user.email",
            totalSpend: 1,
            orderCount: 1,
          },
        },
      ]),
    ]);

  const returningCustomers =
    returningCustomersAgg.length > 0
      ? returningCustomersAgg[0].count
      : 0;

  res.json(
    ApiResponse.ok({
      newCustomersThisMonth,
      returningCustomers,
      topCustomersBySpend,
    })
  );
});

// GET /api/admin/dashboard/reports/products
const getProductReport = asyncHandler(async (req, res) => {
  const topProducts = await Order.aggregate([
    { $match: { "payment.status": "paid" } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        totalQuantity: { $sum: "$items.quantity" },
        totalRevenue: {
          $sum: { $multiply: ["$items.price", "$items.quantity"] },
        },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        productId: "$_id",
        name: 1,
        totalQuantity: 1,
        totalRevenue: 1,
      },
    },
  ]);

  res.json(ApiResponse.ok(topProducts));
});

module.exports = {
  getOverview,
  getSalesReport,
  getCustomerReport,
  getProductReport,
};
