const { Router } = require("express");
const {
  getPublicSettings,
  getMaintenance,
} = require("../controllers/settings.controller");

const router = Router();

// GET /api/settings/public
router.get("/public", getPublicSettings);

// GET /api/settings/maintenance — small, uncached; the storefront root layout hits
// this on every render to decide whether to serve the maintenance screen.
router.get("/maintenance", getMaintenance);

module.exports = router;
