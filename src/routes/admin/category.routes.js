const { Router } = require("express");
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../../controllers/admin/category.controller");

const router = Router();

router.get("/", listCategories);
router.post("/", createCategory);
router.patch("/:id", updateCategory);
router.delete("/:id", deleteCategory);

module.exports = router;
