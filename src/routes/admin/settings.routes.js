const { Router } = require("express");
const {
  getSettings,
  updateSettings,
} = require("../../controllers/admin/settings.controller");

const router = Router();

router.get("/", getSettings);
router.patch("/", updateSettings);

module.exports = router;
