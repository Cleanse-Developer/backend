const { Router } = require("express");
const upload = require("../../middleware/upload");
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../../controllers/admin/category.controller");

const router = Router();

const bannerUpload = upload.fields([
  { name: "bannerTop", maxCount: 1 },
  { name: "bannerBottom", maxCount: 1 },
]);

router.get("/", listCategories);
router.post("/", bannerUpload, createCategory);
router.patch("/:id", bannerUpload, updateCategory);
router.delete("/:id", deleteCategory);

module.exports = router;
