const { Router } = require("express");
const {
  listReferrals,
  getReferralStats,
  markRewarded,
  reverseReferral,
} = require("../../controllers/admin/referral.controller");

const router = Router();

router.get("/", listReferrals);
router.get("/stats", getReferralStats);
router.post("/:id/mark-rewarded", markRewarded);
router.post("/:id/reverse", reverseReferral);

module.exports = router;
