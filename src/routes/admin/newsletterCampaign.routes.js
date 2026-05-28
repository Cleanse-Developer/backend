const { Router } = require("express");
const {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
} = require("../../controllers/admin/newsletterCampaign.controller");

const router = Router();

router.get("/", listCampaigns);
router.get("/:id", getCampaign);
router.post("/", createCampaign);
router.patch("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);
router.post("/:id/send", sendCampaign);

module.exports = router;
