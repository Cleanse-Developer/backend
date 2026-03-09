const { Router } = require("express");
const { submitReview } = require("../controllers/review.controller");
const { submitReviewRules } = require("../validators/review.validator");
const validate = require("../middleware/validate");

const router = Router();

// POST /api/reviews — submit a review (protected, auth applied in index)
router.post("/", submitReviewRules, validate, submitReview);

module.exports = router;
