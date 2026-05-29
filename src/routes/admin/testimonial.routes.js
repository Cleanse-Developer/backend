const { Router } = require("express");
const upload = require("../../middleware/upload");
const {
  getTestimonial,
  listTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
} = require("../../controllers/admin/testimonial.controller");

const router = Router();

const testimonialImageFields = upload.fields([
  { name: "beforeImage", maxCount: 1 },
  { name: "afterImage", maxCount: 1 },
  { name: "beforeImageDesktop", maxCount: 1 },
  { name: "beforeImageTablet", maxCount: 1 },
  { name: "beforeImageMobile", maxCount: 1 },
  { name: "afterImageDesktop", maxCount: 1 },
  { name: "afterImageTablet", maxCount: 1 },
  { name: "afterImageMobile", maxCount: 1 },
]);

router.get("/", listTestimonials);
router.get("/:id", getTestimonial);
router.post("/", testimonialImageFields, createTestimonial);
router.patch("/:id", testimonialImageFields, updateTestimonial);
router.delete("/:id", deleteTestimonial);

module.exports = router;
