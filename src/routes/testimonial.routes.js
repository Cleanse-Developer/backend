const { Router } = require("express");
const { listTestimonials } = require("../controllers/testimonial.controller");

const router = Router();

// GET /api/testimonials
router.get("/", listTestimonials);

module.exports = router;
