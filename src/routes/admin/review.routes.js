const { Router } = require("express");
const {
  listReviews,
  getStats,
  approveReview,
  deleteReview,
} = require("../../controllers/admin/review.controller");

const router = Router();

router.get("/", listReviews);
router.get("/stats", getStats);
router.patch("/:id/approve", approveReview);
router.delete("/:id", deleteReview);

module.exports = router;
