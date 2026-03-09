const Ticket = require("../../models/Ticket");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { paginationMeta } = require("../../utils/pagination");

// GET /api/admin/tickets
const listTickets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, priority, search } = req.query;

  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (priority) {
    filter.priority = priority;
  }

  if (search) {
    filter.ticketId = { $regex: search, $options: "i" };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [tickets, total] = await Promise.all([
    Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("user", "fullName email")
      .lean(),
    Ticket.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      tickets,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/tickets/:id
const getTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id)
    .populate("user", "fullName email phone")
    .populate("order")
    .populate("assignedTo", "fullName email")
    .lean();

  if (!ticket) {
    throw ApiError.notFound("Ticket not found");
  }

  res.json(ApiResponse.ok(ticket));
});

// PATCH /api/admin/tickets/:id
const updateTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) {
    throw ApiError.notFound("Ticket not found");
  }

  const { status, priority, assignedTo, message } = req.body;

  if (status) {
    ticket.status = status;
  }

  if (priority) {
    ticket.priority = priority;
  }

  if (assignedTo) {
    ticket.assignedTo = assignedTo;
  }

  // If message provided, push to messages array as "support" sender
  if (message) {
    ticket.messages.push({
      sender: "support",
      text: message,
      createdAt: new Date(),
    });
  }

  // If status is "resolved", set resolvedAt
  if (status === "resolved") {
    ticket.resolvedAt = new Date();
  }

  await ticket.save();

  res.json(ApiResponse.ok(ticket, "Ticket updated"));
});

module.exports = { listTickets, getTicket, updateTicket };
