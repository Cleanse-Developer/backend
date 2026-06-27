const { Router } = require("express");
const { uploadMedia } = require("../../middleware/upload");
const {
  listMedia,
  getMedia,
  uploadMediaAsset,
} = require("../../controllers/admin/media.controller");

const router = Router();

// Read + create only — no destructive routes by design.
router.get("/", listMedia);
router.post("/", uploadMedia.single("file"), uploadMediaAsset);
router.get("/:id", getMedia);

module.exports = router;
