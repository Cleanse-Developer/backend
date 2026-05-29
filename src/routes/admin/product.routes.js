const { Router } = require("express");
const upload = require("../../middleware/upload");
const {
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
} = require("../../controllers/admin/product.controller");

const router = Router();

router.get("/", listProducts);
router.post("/", upload.any(), createProduct);
router.get("/:id", getProduct);
router.patch("/:id/restore", restoreProduct);
router.patch("/:id", upload.any(), updateProduct);
router.delete("/:id", deleteProduct);

module.exports = router;
