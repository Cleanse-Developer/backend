const { Router } = require("express");
const {
  listZones,
  createZone,
  updateZone,
  deleteZone,
  getChargeMode,
  setChargeMode,
} = require("../../controllers/admin/shipping.controller");

const router = Router();

router.get("/", listZones);
router.post("/", createZone);
// Must stay above "/:id", or PATCH /charge-mode would be read as a zone id.
router.get("/charge-mode", getChargeMode);
router.patch("/charge-mode", setChargeMode);
router.patch("/:id", updateZone);
router.delete("/:id", deleteZone);

module.exports = router;
