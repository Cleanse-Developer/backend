const { Router } = require("express");
const {
  listBundles,
  getBundle,
  createBundle,
  updateBundle,
  deleteBundle,
} = require("../../controllers/admin/bundle.controller");

const router = Router();

router.get("/", listBundles);
router.get("/:id", getBundle);
router.post("/", createBundle);
router.patch("/:id", updateBundle);
router.delete("/:id", deleteBundle);

module.exports = router;
