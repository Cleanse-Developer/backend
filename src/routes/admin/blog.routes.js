const { Router } = require("express");
const upload = require("../../middleware/upload");
const {
  listBlogs,
  createBlog,
  updateBlog,
  deleteBlog,
} = require("../../controllers/admin/blog.controller");

const router = Router();

router.get("/", listBlogs);
router.post("/", upload.single("image"), createBlog);
router.patch("/:id", upload.single("image"), updateBlog);
router.delete("/:id", deleteBlog);

module.exports = router;
