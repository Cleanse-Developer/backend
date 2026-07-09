const { Router } = require("express");
const { trackAndRedirect } = require("../controllers/promoter.controller");

// Public, unauthenticated promoter link redirect. Mounted at the app root so
// shareable links are short: GET /r/:slug
const router = Router();

router.get("/:slug", trackAndRedirect);

module.exports = router;
