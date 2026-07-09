const Promoter = require("../../models/Promoter");
const PromoterLink = require("../../models/PromoterLink");
const Coupon = require("../../models/Coupon");
const SpecialCoupon = require("../../models/SpecialCoupon");
const CommissionLedger = require("../../models/CommissionLedger");
const Settlement = require("../../models/Settlement");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");
const {
  generatePromoterCode,
  generateLinkSlug,
  recomputePromoterTotals,
  createSettlement,
  finalizeSettlement,
} = require("../../services/promoter.service");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Ensure a code is not already taken by ANY Coupon or SpecialCoupon.
const assertCodeAvailable = async (upperCode) => {
  const [c, s] = await Promise.all([
    Coupon.findOne({ code: upperCode }).select("_id").lean(),
    SpecialCoupon.findOne({ code: upperCode }).select("_id").lean(),
  ]);
  if (c || s) {
    throw ApiError.conflict(
      `Code "${upperCode}" already exists. Codes must be unique across all coupon types.`
    );
  }
};

// GET /api/admin/promoters
const listPromoters = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const { status } = req.query;
  const search = (req.query.search || "").trim();

  const filter = {};
  if (status && ["active", "paused", "archived"].includes(status)) {
    filter.status = status;
  }
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [
      { name: rx },
      { code: rx },
      { "contact.email": rx },
      { "contact.instagram": rx },
    ];
  }

  const [promoters, total] = await Promise.all([
    Promoter.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Promoter.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      promoters,
      pagination: paginationMeta(total, page, limit),
    })
  );
});

// GET /api/admin/promoters/stats
const getPromoterStats = asyncHandler(async (req, res) => {
  const [total, active] = await Promise.all([
    Promoter.countDocuments({}),
    Promoter.countDocuments({ status: "active" }),
  ]);

  const agg = await Promoter.aggregate([
    {
      $group: {
        _id: null,
        totalPending: { $sum: "$totals.totalPending" },
        totalApproved: { $sum: "$totals.totalApproved" },
        totalSettled: { $sum: "$totals.totalSettled" },
        totalClicks: { $sum: "$totals.totalClicks" },
        totalOrders: { $sum: "$totals.totalOrders" },
      },
    },
  ]);
  const sums = agg[0] || {};

  res.json(
    ApiResponse.ok({
      total,
      active,
      totalPending: sums.totalPending || 0,
      totalApproved: sums.totalApproved || 0,
      totalSettled: sums.totalSettled || 0,
      totalClicks: sums.totalClicks || 0,
      totalOrders: sums.totalOrders || 0,
    })
  );
});

// POST /api/admin/promoters
const createPromoter = asyncHandler(async (req, res) => {
  const { name, code, status, contact, channel, audienceSize, commission, payout, notes } =
    req.body;

  if (!name || !name.trim()) {
    throw ApiError.badRequest("name is required");
  }

  let finalCode;
  if (code && code.trim()) {
    finalCode = code.trim().toUpperCase();
    const existing = await Promoter.findOne({ code: finalCode }).select("_id").lean();
    if (existing) {
      throw ApiError.conflict(`Promoter with code "${finalCode}" already exists`);
    }
  } else {
    finalCode = await generatePromoterCode(name);
  }

  const promoter = await Promoter.create({
    name: name.trim(),
    code: finalCode,
    status: status || "active",
    contact,
    channel,
    audienceSize,
    commission,
    payout,
    notes,
    createdBy: req.user._id,
  });

  res.status(201).json(ApiResponse.created({ promoter }));
});

// GET /api/admin/promoters/:id
const getPromoter = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id).lean();
  if (!promoter) throw ApiError.notFound("Promoter not found");

  const [links, codes, specialCodes] = await Promise.all([
    PromoterLink.find({ promoter: promoter._id }).sort({ createdAt: -1 }).lean(),
    Coupon.find({ promoter: promoter._id })
      .select("code description discountType discountValue validTill isActive usageCount perUserLimit")
      .lean(),
    SpecialCoupon.find({ promoter: promoter._id })
      .select("code title promotionType applicationMethod validTill isActive usageCount")
      .lean(),
  ]);

  res.json(
    ApiResponse.ok({
      promoter,
      links,
      codes: [
        ...codes.map((c) => ({ ...c, kind: "coupon" })),
        ...specialCodes.map((c) => ({ ...c, kind: "special_coupon" })),
      ],
    })
  );
});

// PATCH /api/admin/promoters/:id
const updatePromoter = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id);
  if (!promoter) throw ApiError.notFound("Promoter not found");

  if (req.body.code) {
    const upper = req.body.code.trim().toUpperCase();
    if (upper !== promoter.code) {
      const existing = await Promoter.findOne({ code: upper }).select("_id").lean();
      if (existing) throw ApiError.conflict(`Promoter code "${upper}" already exists`);
    }
    req.body.code = upper;
  }

  const allowed = [
    "name",
    "code",
    "status",
    "contact",
    "channel",
    "audienceSize",
    "commission",
    "payout",
    "linkedUser",
    "notes",
  ];
  for (const field of allowed) {
    if (req.body[field] !== undefined) promoter[field] = req.body[field];
  }
  await promoter.save();

  res.json(ApiResponse.ok({ promoter }, "Promoter updated"));
});

// DELETE /api/admin/promoters/:id  — soft-delete (archive), never hard-delete
// referenced promoters (orders/ledger point at them).
const deletePromoter = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id);
  if (!promoter) throw ApiError.notFound("Promoter not found");
  promoter.status = "archived";
  await promoter.save();
  res.json(ApiResponse.ok({ promoter }, "Promoter archived"));
});

// ------------------------------- Links -------------------------------------

// GET /api/admin/promoters/:id/links
const listLinks = asyncHandler(async (req, res) => {
  const links = await PromoterLink.find({ promoter: req.params.id })
    .sort({ createdAt: -1 })
    .lean();
  res.json(ApiResponse.ok({ links }));
});

// POST /api/admin/promoters/:id/links
const createLink = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id).select("_id").lean();
  if (!promoter) throw ApiError.notFound("Promoter not found");

  const { label, destinationPath, boundCouponCode, slug } = req.body;

  let finalSlug;
  if (slug && slug.trim()) {
    finalSlug = slug.trim().toLowerCase();
    const exists = await PromoterLink.exists({ slug: finalSlug });
    if (exists) throw ApiError.conflict(`Link slug "${finalSlug}" already exists`);
  } else {
    finalSlug = await generateLinkSlug(label || promoter.code);
  }

  // If a bound code is given, it must belong to this promoter.
  let boundCode = null;
  if (boundCouponCode && boundCouponCode.trim()) {
    boundCode = boundCouponCode.trim().toUpperCase();
    const [c, s] = await Promise.all([
      Coupon.findOne({ code: boundCode }).select("promoter").lean(),
      SpecialCoupon.findOne({ code: boundCode }).select("promoter").lean(),
    ]);
    const owner = c?.promoter || s?.promoter;
    if (!owner) {
      throw ApiError.badRequest(`Code "${boundCode}" is not a promoter code`);
    }
    if (owner.toString() !== promoter._id.toString()) {
      throw ApiError.badRequest(`Code "${boundCode}" belongs to a different promoter`);
    }
  }

  const link = await PromoterLink.create({
    promoter: promoter._id,
    slug: finalSlug,
    label,
    destinationPath: destinationPath || "/",
    boundCouponCode: boundCode,
  });

  res.status(201).json(ApiResponse.created({ link }));
});

// PATCH /api/admin/promoters/:id/links/:linkId
const updateLink = asyncHandler(async (req, res) => {
  const link = await PromoterLink.findOne({
    _id: req.params.linkId,
    promoter: req.params.id,
  });
  if (!link) throw ApiError.notFound("Link not found");

  const allowed = ["label", "destinationPath", "isActive"];
  for (const field of allowed) {
    if (req.body[field] !== undefined) link[field] = req.body[field];
  }
  if (req.body.boundCouponCode !== undefined) {
    link.boundCouponCode = req.body.boundCouponCode
      ? req.body.boundCouponCode.trim().toUpperCase()
      : null;
  }
  await link.save();

  res.json(ApiResponse.ok({ link }, "Link updated"));
});

// ------------------------------- Codes -------------------------------------

// POST /api/admin/promoters/:id/codes
// Create a NEW regular coupon owned by the promoter. usageLimit is intentionally
// left unset (unlimited total uses) so the code works for many buyers; perUserLimit
// defaults to 1 (each customer once) but is admin-overridable.
const createCode = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id).select("_id status").lean();
  if (!promoter) throw ApiError.notFound("Promoter not found");

  const {
    code,
    description,
    discountType,
    discountValue,
    minOrderValue,
    maxDiscountAmount,
    validFrom,
    validTill,
    perUserLimit,
    usageLimit,
  } = req.body;

  if (!code || !description || !discountType || discountValue == null || !validTill) {
    throw ApiError.badRequest(
      "code, description, discountType, discountValue and validTill are required"
    );
  }
  const upper = code.trim().toUpperCase();
  await assertCodeAvailable(upper);

  const coupon = await Coupon.create({
    code: upper,
    description,
    discountType,
    discountValue,
    minOrderValue,
    maxDiscountAmount,
    validFrom,
    validTill,
    // usageLimit deliberately omitted unless explicitly provided → unlimited total.
    ...(usageLimit != null ? { usageLimit } : {}),
    perUserLimit: perUserLimit != null ? perUserLimit : 1,
    isActive: true,
    promoter: promoter._id,
  });

  res.status(201).json(ApiResponse.created({ coupon }));
});

// POST /api/admin/promoters/:id/codes/attach
// Bind an EXISTING coupon or code-based special coupon to the promoter.
const attachCode = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id).select("_id").lean();
  if (!promoter) throw ApiError.notFound("Promoter not found");

  const code = (req.body.code || "").trim().toUpperCase();
  if (!code) throw ApiError.badRequest("code is required");

  const coupon = await Coupon.findOne({ code });
  if (coupon) {
    if (coupon.promoter && coupon.promoter.toString() !== promoter._id.toString()) {
      throw ApiError.conflict("Code already belongs to another promoter");
    }
    coupon.promoter = promoter._id;
    await coupon.save();
    return res.json(ApiResponse.ok({ code, kind: "coupon" }, "Code attached"));
  }

  const special = await SpecialCoupon.findOne({ code });
  if (special) {
    if (special.applicationMethod !== "code") {
      throw ApiError.badRequest(
        "Only code-based special coupons can be attached (automatic promotions have no code to share)"
      );
    }
    if (special.promoter && special.promoter.toString() !== promoter._id.toString()) {
      throw ApiError.conflict("Code already belongs to another promoter");
    }
    special.promoter = promoter._id;
    await special.save();
    return res.json(ApiResponse.ok({ code, kind: "special_coupon" }, "Code attached"));
  }

  throw ApiError.notFound(`No coupon or special coupon found with code "${code}"`);
});

// DELETE /api/admin/promoters/:id/codes/:code  — unbind (does not delete the coupon)
const unbindCode = asyncHandler(async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const promoterId = req.params.id;
  const [c, s] = await Promise.all([
    Coupon.updateOne({ code, promoter: promoterId }, { $set: { promoter: null } }),
    SpecialCoupon.updateOne({ code, promoter: promoterId }, { $set: { promoter: null } }),
  ]);
  if (c.modifiedCount === 0 && s.modifiedCount === 0) {
    throw ApiError.notFound("Bound code not found for this promoter");
  }
  // Also clear any link bound to this code.
  await PromoterLink.updateMany(
    { promoter: promoterId, boundCouponCode: code },
    { $set: { boundCouponCode: null } }
  );
  res.json(ApiResponse.ok(null, "Code unbound"));
});

// ---------------------------- Commissions ----------------------------------

// GET /api/admin/promoters/:id/commissions
const listCommissions = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const { status } = req.query;

  const filter = { promoter: req.params.id };
  if (status && ["pending", "approved", "reversed", "settled"].includes(status)) {
    filter.status = status;
  }

  const [entries, total] = await Promise.all([
    CommissionLedger.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("order", "orderId status pricing.total")
      .lean(),
    CommissionLedger.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({ entries, pagination: paginationMeta(total, page, limit) })
  );
});

// POST /api/admin/promoters/:id/commissions/:ledgerId/reverse  — manual dispute reversal
const reverseCommissionEntry = asyncHandler(async (req, res) => {
  const entry = await CommissionLedger.findOne({
    _id: req.params.ledgerId,
    promoter: req.params.id,
  });
  if (!entry) throw ApiError.notFound("Commission entry not found");
  if (entry.status === "reversed") {
    throw ApiError.badRequest("Entry is already reversed");
  }
  entry.status = "reversed";
  entry.reversedAt = new Date();
  entry.description = `${entry.description || ""} [admin-reversed]`.trim();
  await entry.save();
  await recomputePromoterTotals(entry.promoter);
  res.json(ApiResponse.ok({ entry }, "Commission reversed"));
});

// GET /api/admin/promoters/:id/analytics
const getAnalytics = asyncHandler(async (req, res) => {
  const promoterId = req.params.id;
  const promoter = await Promoter.findById(promoterId).lean();
  if (!promoter) throw ApiError.notFound("Promoter not found");

  const [byStatus, linkAgg] = await Promise.all([
    CommissionLedger.aggregate([
      { $match: { promoter: promoter._id } },
      { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    PromoterLink.aggregate([
      { $match: { promoter: promoter._id } },
      {
        $group: {
          _id: null,
          clicks: { $sum: "$clickCount" },
          uniqueVisitors: { $sum: "$uniqueVisitorCount" },
          conversions: { $sum: "$conversionCount" },
          links: { $sum: 1 },
        },
      },
    ]),
  ]);

  const commission = { pending: 0, approved: 0, reversed: 0, settled: 0 };
  for (const r of byStatus) {
    if (r._id in commission) commission[r._id] = r.amount;
  }
  const reach = linkAgg[0] || { clicks: 0, uniqueVisitors: 0, conversions: 0, links: 0 };

  res.json(
    ApiResponse.ok({
      totals: promoter.totals,
      commission,
      reach,
    })
  );
});

// ---------------------------- Settlements ----------------------------------

// GET /api/admin/promoters/:id/settlements
const listSettlements = asyncHandler(async (req, res) => {
  const settlements = await Settlement.find({ promoter: req.params.id })
    .sort({ createdAt: -1 })
    .lean();
  res.json(ApiResponse.ok({ settlements }));
});

// POST /api/admin/promoters/:id/settlements
const createSettlementCtrl = asyncHandler(async (req, res) => {
  const promoter = await Promoter.findById(req.params.id).select("_id").lean();
  if (!promoter) throw ApiError.notFound("Promoter not found");

  const settlement = await createSettlement(promoter._id, {
    periodFrom: req.body.periodFrom,
    periodTo: req.body.periodTo,
    createdBy: req.user._id,
  });

  if (settlement.entryCount === 0) {
    // Nothing to settle — remove the empty draft and tell the admin.
    await Settlement.deleteOne({ _id: settlement._id });
    throw ApiError.badRequest("No approved, unsettled commissions in this period");
  }

  res.status(201).json(ApiResponse.created({ settlement }));
});

// POST /api/admin/promoters/:id/settlements/:sid/finalize
const finalizeSettlementCtrl = asyncHandler(async (req, res) => {
  const settlement = await Settlement.findOne({
    _id: req.params.sid,
    promoter: req.params.id,
  });
  if (!settlement) throw ApiError.notFound("Settlement not found");

  const result = await finalizeSettlement(settlement._id, {
    reference: req.body.reference,
    method: req.body.method,
  });
  if (!result.success) {
    throw ApiError.badRequest(`Cannot finalize settlement (${result.reason})`);
  }

  res.json(ApiResponse.ok({ settlement: result.settlement }, "Settlement finalized"));
});

module.exports = {
  listPromoters,
  getPromoterStats,
  createPromoter,
  getPromoter,
  updatePromoter,
  deletePromoter,
  listLinks,
  createLink,
  updateLink,
  createCode,
  attachCode,
  unbindCode,
  listCommissions,
  reverseCommissionEntry,
  getAnalytics,
  listSettlements,
  createSettlementCtrl,
  finalizeSettlementCtrl,
};
