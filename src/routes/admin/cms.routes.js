const { Router } = require("express");
const upload = require("../../middleware/upload");
const { uploadMedia } = require("../../middleware/upload");
const {
  uploadCmsImage,
  uploadCmsVideo,
  getCmsSection,
  updateCmsSection,
  syncInstagramReels,
} = require("../../controllers/admin/cms.controller");

const router = Router();

router.post("/upload-image", upload.single("image"), uploadCmsImage);
router.post("/upload-video", uploadMedia.single("video"), uploadCmsVideo);
// Static route before "/:key" so it isn't captured by the param route.
router.post("/instagram/sync-reels", syncInstagramReels);
router.get("/:key", getCmsSection);
router.patch("/:key", updateCmsSection);

module.exports = router;
