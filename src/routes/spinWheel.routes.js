const { Router } = require("express");
const { spin } = require("../controllers/spinWheel.controller");

const router = Router();

// POST /api/spin-wheel
router.post("/", spin);

module.exports = router;
