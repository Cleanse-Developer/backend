const { Router } = require("express");
const {
  listBundles,
  getFeaturedBundle,
  getBundle,
} = require("../controllers/bundle.controller");

const router = Router();

router.get("/", listBundles);
// Must precede "/:slug" — otherwise "featured" is matched as a bundle slug.
router.get("/featured", getFeaturedBundle);
router.get("/:slug", getBundle);

module.exports = router;
