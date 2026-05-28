const { Router } = require("express");
const {
  listSubscribers,
  getStats,
  exportSubscribers,
  toggleNewsletterPopup,
  updatePopupConfig,
  getPopupConfig,
  deleteSubscriber,
  toggleSubscriber,
} = require("../../controllers/admin/newsletter.controller");

const router = Router();

// Campaigns sub-routes
router.use("/campaigns", require("./newsletterCampaign.routes"));

router.get("/subscribers", listSubscribers);
router.delete("/subscribers/:id", deleteSubscriber);
router.patch("/subscribers/:id/toggle", toggleSubscriber);
router.get("/stats", getStats);
router.get("/export", exportSubscribers);
router.patch("/toggle", toggleNewsletterPopup);
router.get("/config", getPopupConfig);
router.patch("/config", updatePopupConfig);

module.exports = router;
