const { Router } = require("express");
const {
  submitReview,
  updateMyReview,
  deleteMyReview,
  getMyReviews,
} = require("../controllers/review.controller");
const { submitReviewRules } = require("../validators/review.validator");
const validate = require("../middleware/validate");

const router = Router();

// POST /api/reviews — submit a review (protected, auth applied in index)
router.post("/", submitReviewRules, validate, submitReview);
router.get("/me", getMyReviews);
router.patch("/:id", updateMyReview);
router.delete("/:id", deleteMyReview);

module.exports = router;
