const { Router } = require("express");
const wa = require("../../controllers/admin/whatsapp.controller");

const router = Router();

// Auth + role guard applied by the admin router (routes/admin/index.js).
router.get("/templates", wa.listTemplates);
router.get("/logs", wa.getLogs);
router.post("/send", wa.sendTemplate);
router.post("/orders/:orderId/confirm", wa.confirmCod);
router.post("/orders/:orderId/cancel", wa.cancelCod);

module.exports = router;
