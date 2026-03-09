const { Router } = require("express");
const { submitContact } = require("../controllers/contact.controller");
const { contactRules } = require("../validators/contact.validator");
const validate = require("../middleware/validate");

const router = Router();

// POST /api/contact — submit a contact message
router.post("/", contactRules, validate, submitContact);

module.exports = router;
