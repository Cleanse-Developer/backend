const { Router } = require("express");
const {
  listPromoters,
  getPromoterStats,
  createPromoter,
  getPromoter,
  updatePromoter,
  deletePromoter,
  listLinks,
  createLink,
  updateLink,
  createCode,
  attachCode,
  unbindCode,
  listCommissions,
  reverseCommissionEntry,
  getAnalytics,
  listSettlements,
  createSettlementCtrl,
  finalizeSettlementCtrl,
} = require("../../controllers/admin/promoter.controller");

const router = Router();

router.get("/stats", getPromoterStats);

router.get("/", listPromoters);
router.post("/", createPromoter);
router.get("/:id", getPromoter);
router.patch("/:id", updatePromoter);
router.delete("/:id", deletePromoter);

// Links
router.get("/:id/links", listLinks);
router.post("/:id/links", createLink);
router.patch("/:id/links/:linkId", updateLink);

// Codes (coupons/special coupons bound to the promoter)
router.post("/:id/codes", createCode);
router.post("/:id/codes/attach", attachCode);
router.delete("/:id/codes/:code", unbindCode);

// Commissions
router.get("/:id/commissions", listCommissions);
router.post("/:id/commissions/:ledgerId/reverse", reverseCommissionEntry);
router.get("/:id/analytics", getAnalytics);

// Settlements
router.get("/:id/settlements", listSettlements);
router.post("/:id/settlements", createSettlementCtrl);
router.post("/:id/settlements/:sid/finalize", finalizeSettlementCtrl);

module.exports = router;
