const { Router } = require("express");
const {
  listCustomers,
  getCustomer,
} = require("../../controllers/admin/customer.controller");

const router = Router();

router.get("/", listCustomers);
router.get("/:id", getCustomer);

module.exports = router;
