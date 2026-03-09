const { Router } = require("express");
const { subscribe } = require("../controllers/newsletter.controller");

const router = Router();

// POST /api/newsletter/subscribe
router.post("/subscribe", subscribe);

module.exports = router;
