const { Router } = require("express");
const upload = require("../../middleware/upload");
const { uploadMedia } = require("../../middleware/upload");
const {
  uploadCmsImage,
  uploadCmsVideo,
  getCmsSection,
  updateCmsSection,
} = require("../../controllers/admin/cms.controller");

const router = Router();

router.post("/upload-image", upload.single("image"), uploadCmsImage);
router.post("/upload-video", uploadMedia.single("video"), uploadCmsVideo);
router.get("/:key", getCmsSection);
router.patch("/:key", updateCmsSection);

module.exports = router;
