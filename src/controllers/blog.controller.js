const Blog = require("../models/Blog");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { paginationMeta } = require("../utils/pagination");

// GET /api/blogs
const listBlogs = asyncHandler(async (req, res) => {
  const { category, featured, page = 1, limit = 10 } = req.query;

  const filter = { isPublished: true };

  if (category) {
    filter.category = category;
  }

  if (featured === "true") {
    filter.isFeatured = true;
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("author", "name role avatar")
      .lean(),
    Blog.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok(
      {
        blogs,
        pagination: paginationMeta(total, pageNum, limitNum),
      },
      "Blogs fetched successfully"
    )
  );
});

// GET /api/blogs/:slug
const getBlog = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const blog = await Blog.findOne({ slug, isPublished: true })
    .populate("author", "name role avatar")
    .lean();

  if (!blog) {
    throw ApiError.notFound("Blog not found");
  }

  // Increment viewCount (fire-and-forget)
  Blog.updateOne({ _id: blog._id }, { $inc: { viewCount: 1 } }).exec();

  // Fetch 3 related blogs from the same category, excluding the current one
  const relatedBlogs = await Blog.find({
    isPublished: true,
    category: blog.category,
    _id: { $ne: blog._id },
  })
    .sort({ publishedAt: -1 })
    .limit(3)
    .populate("author", "name role avatar")
    .lean();

  res.json(
    ApiResponse.ok(
      {
        blog,
        relatedBlogs,
      },
      "Blog fetched successfully"
    )
  );
});

module.exports = { listBlogs, getBlog };
