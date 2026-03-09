const { Router } = require("express");
const upload = require("../../middleware/upload");
const {
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
} = require("../../controllers/admin/product.controller");

const router = Router();

router.get("/", listProducts);
router.post("/", upload.array("images", 5), createProduct);
router.get("/:id", getProduct);
router.patch("/:id", upload.array("images", 5), updateProduct);
router.delete("/:id", deleteProduct);

module.exports = router;
