const { Router } = require("express");
const { listBlogs, getBlog } = require("../controllers/blog.controller");

const router = Router();

router.get("/", listBlogs);
router.get("/:slug", getBlog);

module.exports = router;
