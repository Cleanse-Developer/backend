const { Router } = require("express");
const { subscribe, unsubscribe } = require("../controllers/newsletter.controller");

const router = Router();

router.post("/subscribe", subscribe);
router.get("/unsubscribe", unsubscribe);

module.exports = router;
