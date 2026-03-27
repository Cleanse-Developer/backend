const { Router } = require("express");
const {
  listPrizes,
  createPrize,
  updatePrize,
  deletePrize,
  listEntries,
  toggleSpinWheel,
} = require("../../controllers/admin/spinWheel.controller");

const router = Router();

router.get("/prizes", listPrizes);
router.post("/prizes", createPrize);
router.patch("/prizes/:id", updatePrize);
router.delete("/prizes/:id", deletePrize);
router.get("/entries", listEntries);
router.patch("/toggle", toggleSpinWheel);

module.exports = router;
