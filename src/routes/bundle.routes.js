const { Router } = require("express");
const { listBundles, getBundle } = require("../controllers/bundle.controller");

const router = Router();

router.get("/", listBundles);
router.get("/:slug", getBundle);

module.exports = router;
