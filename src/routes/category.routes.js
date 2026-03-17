const { Router } = require("express");
const { listCategories } = require("../controllers/category.controller");

const router = Router();

// GET /api/categories
router.get("/", listCategories);

module.exports = router;
