const { Router } = require("express");
const { getPublicSettings } = require("../controllers/settings.controller");

const router = Router();

// GET /api/settings/public
router.get("/public", getPublicSettings);

module.exports = router;
