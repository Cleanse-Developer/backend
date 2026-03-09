const User = require("../../models/User");
const Order = require("../../models/Order");
const Address = require("../../models/Address");
const LoyaltyTransaction = require("../../models/LoyaltyTransaction");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");

// GET /api/admin/customers
const listCustomers = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    sort = "-createdAt",
  } = req.query;

  const filter = { role: "customer" };

  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const sortObj = {};
  const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
  const sortDir = sort.startsWith("-") ? -1 : 1;
  sortObj[sortField] = sortDir;

  const [customers, total] = await Promise.all([
    User.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      customers,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/customers/:id
const getCustomer = asyncHandler(async (req, res) => {
  const customer = await User.findById(req.params.id).lean();

  if (!customer) {
    throw ApiError.notFound("Customer not found");
  }

  const [orders, addresses, loyaltyTransactions, referralCount] =
    await Promise.all([
      Order.find({ user: customer._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Address.find({ user: customer._id })
        .sort({ isDefault: -1, createdAt: -1 })
        .lean(),
      LoyaltyTransaction.find({ user: customer._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      User.countDocuments({ referredBy: customer._id }),
    ]);

  res.json(
    ApiResponse.ok({
      customer,
      orders,
      addresses,
      loyaltyTransactions,
      referralCount,
    })
  );
});

module.exports = { listCustomers, getCustomer };
