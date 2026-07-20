const { Router } = require("express");
const { submitContact } = require("../controllers/contact.controller");
const { contactRules } = require("../validators/contact.validator");
const validate = require("../middleware/validate");
const { contactLimiter } = require("../middleware/rateLimiter");

const router = Router();

// POST /api/contact — submit a contact message. Public (no login) but
// rate-limited per IP; the controller adds honeypot + duplicate checks.
router.post("/", contactLimiter, contactRules, validate, submitContact);

module.exports = router;
