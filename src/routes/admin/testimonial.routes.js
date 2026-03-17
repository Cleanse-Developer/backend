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

router.get("/", listTestimonials);
router.get("/:id", getTestimonial);
router.post("/", upload.fields([{ name: "beforeImage", maxCount: 1 }, { name: "afterImage", maxCount: 1 }]), createTestimonial);
router.patch("/:id", upload.fields([{ name: "beforeImage", maxCount: 1 }, { name: "afterImage", maxCount: 1 }]), updateTestimonial);
router.delete("/:id", deleteTestimonial);

module.exports = router;
