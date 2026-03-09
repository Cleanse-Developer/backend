const { Router } = require("express");
const {
  getOverview,
  getSalesReport,
  getCustomerReport,
  getProductReport,
} = require("../../controllers/admin/dashboard.controller");

const router = Router();

router.get("/", getOverview);
router.get("/reports/sales", getSalesReport);
router.get("/reports/customers", getCustomerReport);
router.get("/reports/products", getProductReport);

module.exports = router;
