const { Router } = require("express");
const {
  initiateCheckout,
  confirmCheckout,
} = require("../controllers/checkout.controller");
const {
  initiateCheckoutRules,
  confirmCheckoutRules,
} = require("../validators/checkout.validator");
const validate = require("../middleware/validate");

const router = Router();

router.post("/initiate", initiateCheckoutRules, validate, initiateCheckout);
router.post("/confirm", confirmCheckoutRules, validate, confirmCheckout);

module.exports = router;
