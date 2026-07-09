const { Router } = require("express");
const { listAbandonedCarts } = require("../controllers/abandonedCart.controller");
const { listAbandonedCartsRules } = require("../validators/abandonedCart.validator");
const validate = require("../middleware/validate");

const router = Router();

// GET /api/public/abandoned-carts — public list of abandoned carts + count
router.get("/", listAbandonedCartsRules, validate, listAbandonedCarts);

module.exports = router;
