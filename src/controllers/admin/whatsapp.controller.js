const mongoose = require("mongoose");
const Order = require("../../models/Order");
const asyncHandler = require("../../utils/asyncHandler");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const whatsappClient = require("../../config/whatsapp");
const { confirmCodOrder, cancelCodOrder } = require("../../services/order.service");

// Surface slide's own error (status + message) to the admin instead of a 500.
const proxy = (fn) =>
  asyncHandler(async (req, res) => {
    try {
      const data = await fn(req);
      res.json(ApiResponse.ok(data));
    } catch (err) {
      throw new ApiError(err.status || 502, err.message || "WhatsApp API error");
    }
  });

// GET /api/admin/whatsapp/templates
const listTemplates = proxy((req) => whatsappClient.listTemplates(req.query));

// GET /api/admin/whatsapp/logs
const getLogs = proxy((req) => whatsappClient.getLogs(req.query));

// POST /api/admin/whatsapp/send
const sendTemplate = asyncHandler(async (req, res) => {
  const { to, templateName, languageCode, components } = req.body;
  if (!to || !templateName || !languageCode) {
    throw ApiError.badRequest("to, templateName and languageCode are required");
  }
  // E.164 digits only, no "+".
  const cleanTo = String(to).replace(/\D/g, "");
  if (cleanTo.length < 10) throw ApiError.badRequest("Invalid recipient number");

  try {
    const data = await whatsappClient.sendTemplate({
      to: cleanTo,
      templateName,
      languageCode,
      ...(components ? { components } : {}),
    });
    res.json(ApiResponse.ok(data, "Message sent"));
  } catch (err) {
    throw new ApiError(err.status || 502, err.message || "WhatsApp send failed");
  }
});

// Resolve by Mongo _id or by human orderId ("CA-YYYY-XXXX").
const findOrder = async (idOrOrderId) => {
  if (mongoose.isValidObjectId(idOrOrderId)) {
    const byId = await Order.findById(idOrOrderId);
    if (byId) return byId;
  }
  return Order.findOne({ orderId: idOrOrderId });
};

// POST /api/admin/whatsapp/orders/:orderId/confirm — manual COD approval fallback
const confirmCod = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.orderId);
  if (!order) throw ApiError.notFound("Order not found");
  await confirmCodOrder(order);
  res.json(ApiResponse.ok({ order }, "COD order confirmed"));
});

// POST /api/admin/whatsapp/orders/:orderId/cancel — manual COD rejection fallback
const cancelCod = asyncHandler(async (req, res) => {
  const order = await findOrder(req.params.orderId);
  if (!order) throw ApiError.notFound("Order not found");
  await cancelCodOrder(order, req.body?.reason || "Cancelled by admin");
  res.json(ApiResponse.ok({ order }, "COD order cancelled"));
});

module.exports = { listTemplates, getLogs, sendTemplate, confirmCod, cancelCod };
