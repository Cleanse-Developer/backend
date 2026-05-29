const { Router } = require("express");
const upload = require("../../middleware/upload");
const Author = require("../../models/Author");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const {
  listBlogs,
  getBlog,
  createBlog,
  updateBlog,
  deleteBlog,
} = require("../../controllers/admin/blog.controller");

const router = Router();

// Authors listing for blog form dropdown
router.get(
  "/authors",
  asyncHandler(async (req, res) => {
    const authors = await Author.find({ isActive: true })
      .select("name role avatar")
      .sort({ name: 1 })
      .lean();
    res.json(ApiResponse.ok(authors));
  })
);

router.get("/", listBlogs);
router.get("/:id", getBlog);
const blogImageFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "imageDesktop", maxCount: 1 },
  { name: "imageTablet", maxCount: 1 },
  { name: "imageMobile", maxCount: 1 },
]);

router.post("/", blogImageFields, createBlog);
router.patch("/:id", blogImageFields, updateBlog);
router.delete("/:id", deleteBlog);

module.exports = router;
