const Blog = require("../../models/Blog");
const Author = require("../../models/Author");
const { uploadToCloudinary } = require("../../services/upload.service");
const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { paginationMeta } = require("../../utils/pagination");
const { buildSourcesFromFields } = require("../../utils/imageVariants");

const BLOG_IMAGE_FOLDER = "cleanse-ayurveda/blogs";

const parseSources = (val) => (typeof val === "string" ? JSON.parse(val) : val);

// GET /api/admin/blogs
const listBlogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, category, search } = req.query;

  const filter = {};

  if (status === "published") {
    filter.isPublished = true;
  } else if (status === "draft") {
    filter.isPublished = false;
  }
  // status=all or not provided => no filter on isPublished (return all)

  if (category) {
    filter.category = category;
  }

  if (search) {
    filter.$text = { $search: search };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("author", "name role avatar")
      .lean(),
    Blog.countDocuments(filter),
  ]);

  res.json(
    ApiResponse.ok({
      blogs,
      pagination: paginationMeta(total, pageNum, limitNum),
    })
  );
});

// GET /api/admin/blogs/:id
const getBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findById(req.params.id)
    .populate("author", "name role avatar")
    .lean();
  if (!blog) {
    throw ApiError.notFound("Blog not found");
  }
  res.json(ApiResponse.ok(blog));
});

// POST /api/admin/blogs
const createBlog = asyncHandler(async (req, res) => {
  const {
    title,
    category,
    excerpt,
    content,
    image,
    readTime,
    authorId,
    isFeatured,
    isPublished,
    tags,
    seo,
  } = req.body;

  if (!title) {
    throw ApiError.badRequest("Title is required");
  }

  // Auto-generate slug from title
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  // Check for duplicate slug
  const existingSlug = await Blog.findOne({ slug }).lean();
  const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

  const blogData = {
    title,
    slug: finalSlug,
    category,
    excerpt,
    content: typeof content === "string" ? JSON.parse(content) : content,
    readTime,
    isFeatured: isFeatured === "true" || isFeatured === true,
    isPublished: isPublished === "true" || isPublished === true,
    tags: typeof tags === "string" ? JSON.parse(tags) : tags,
    seo: typeof seo === "string" ? JSON.parse(seo) : seo,
  };

  // Handle base image upload if file present
  const baseImageFile = req.files?.image?.[0];
  if (baseImageFile) {
    const uploaded = await uploadToCloudinary(
      baseImageFile.buffer,
      BLOG_IMAGE_FOLDER
    );
    blogData.image = uploaded.url;
  } else if (image) {
    blogData.image = image;
  }

  // Responsive image variants (optional, per breakpoint)
  blogData.imageSources = await buildSourcesFromFields(
    req.files,
    "image",
    parseSources(req.body.imageSources),
    BLOG_IMAGE_FOLDER
  );

  // Set author
  if (authorId) {
    const author = await Author.findById(authorId).lean();
    if (!author) {
      throw ApiError.notFound("Author not found");
    }
    blogData.author = authorId;
  }

  // If isPublished, set publishedAt
  if (blogData.isPublished) {
    blogData.publishedAt = new Date();
  }

  const blog = await Blog.create(blogData);

  res.status(201).json(ApiResponse.created(blog, "Blog created"));
});

// PATCH /api/admin/blogs/:id
const updateBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) {
    throw ApiError.notFound("Blog not found");
  }

  const updateData = { ...req.body };

  // Handle base image upload
  const baseImageFile = req.files?.image?.[0];
  if (baseImageFile) {
    const uploaded = await uploadToCloudinary(
      baseImageFile.buffer,
      BLOG_IMAGE_FOLDER
    );
    updateData.image = uploaded.url;
  }

  // Responsive image variants — recompute whenever the form sends them or a file lands
  const hasVariantFile =
    req.files?.imageDesktop || req.files?.imageTablet || req.files?.imageMobile;
  if (updateData.imageSources !== undefined || hasVariantFile) {
    updateData.imageSources = await buildSourcesFromFields(
      req.files,
      "image",
      parseSources(updateData.imageSources),
      BLOG_IMAGE_FOLDER
    );
  }

  // Parse JSON strings if needed
  if (typeof updateData.content === "string") {
    updateData.content = JSON.parse(updateData.content);
  }
  if (typeof updateData.tags === "string") {
    updateData.tags = JSON.parse(updateData.tags);
  }
  if (typeof updateData.seo === "string") {
    updateData.seo = JSON.parse(updateData.seo);
  }

  // Normalize booleans
  if (updateData.isFeatured !== undefined) {
    updateData.isFeatured =
      updateData.isFeatured === "true" || updateData.isFeatured === true;
  }
  if (updateData.isPublished !== undefined) {
    updateData.isPublished =
      updateData.isPublished === "true" || updateData.isPublished === true;
  }

  // Set author if authorId provided
  if (updateData.authorId) {
    updateData.author = updateData.authorId;
    delete updateData.authorId;
  }

  Object.assign(blog, updateData);
  await blog.save();

  res.json(ApiResponse.ok(blog, "Blog updated"));
});

// DELETE /api/admin/blogs/:id
const deleteBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) {
    throw ApiError.notFound("Blog not found");
  }

  await Blog.findByIdAndDelete(req.params.id);

  res.json(ApiResponse.ok(null, "Blog deleted"));
});

module.exports = { listBlogs, getBlog, createBlog, updateBlog, deleteBlog };
