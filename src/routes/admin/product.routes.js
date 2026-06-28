const { Router } = require("express");
const upload = require("../../middleware/upload");
const {
  listProducts,
  listFeatured,
  reorderFeatured,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
} = require("../../controllers/admin/product.controller");

const router = Router();

router.get("/", listProducts);
// Static "featured" routes must precede "/:id" so they aren't captured by it.
router.get("/featured", listFeatured);
router.patch("/featured/reorder", reorderFeatured);
router.post("/", upload.any(), createProduct);
router.get("/:id", getProduct);
router.patch("/:id/restore", restoreProduct);
router.patch("/:id", upload.any(), updateProduct);
router.delete("/:id", deleteProduct);

module.exports = router;
