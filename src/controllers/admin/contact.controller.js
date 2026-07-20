const Contact = require("../../models/Contact");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const { paginationMeta } = require("../../utils/pagination");

const STATUSES = ["new", "read", "replied", "closed"];

// GET /api/admin/contact — paginated submissions with search + status filter.
const listContacts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, status } = req.query;

  const filter = {};
  if (search) {
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
      { subject: { $regex: escaped, $options: "i" } },
    ];
  }
  if (status && STATUSES.includes(status)) {
    filter.status = status;
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Math.min(100, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [contacts, total, newCount] = await Promise.all([
    Contact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    Contact.countDocuments(filter),
    Contact.countDocuments({ status: "new" }),
  ]);

  res.json(
    ApiResponse.ok({
      contacts,
      newCount,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// PATCH /api/admin/contact/:id/status
const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${STATUSES.join(", ")}`);
  }
  const contact = await Contact.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true }
  ).lean();
  if (!contact) throw ApiError.notFound("Submission not found");
  res.json(ApiResponse.ok({ contact }, "Status updated"));
});

// DELETE /api/admin/contact/:id
const deleteContact = asyncHandler(async (req, res) => {
  const contact = await Contact.findByIdAndDelete(req.params.id);
  if (!contact) throw ApiError.notFound("Submission not found");
  res.json(ApiResponse.ok(null, "Submission deleted"));
});

module.exports = { listContacts, updateStatus, deleteContact };
