const { Router } = require("express");
const { handleWhatsAppWebhook } = require("../controllers/whatsapp.webhook.controller");

// Public webhook router — mounted before auth in routes/index.js.
// slide posts customer button replies (Confirm/Cancel) here.
const webhookRouter = Router();

// POST /api/whatsapp/webhook
webhookRouter.post("/", handleWhatsAppWebhook);

module.exports = { webhookRouter };
