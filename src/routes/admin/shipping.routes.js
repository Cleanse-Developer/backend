const { Router } = require("express");
const {
  listZones,
  createZone,
  updateZone,
  deleteZone,
} = require("../../controllers/admin/shipping.controller");

const router = Router();

router.get("/", listZones);
router.post("/", createZone);
router.patch("/:id", updateZone);
router.delete("/:id", deleteZone);

module.exports = router;
