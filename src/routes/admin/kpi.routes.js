const { Router } = require("express");
const {
  getSummary,
  getSalesTrend,
  getProfit,
  getOrdersOps,
  getPayments,
  getRefunds,
  getLocations,
  getDiscounts,
  getCustomers,
  getInventory,
  getQuickActions,
} = require("../../controllers/admin/kpi.controller");

const router = Router();

router.get("/summary", getSummary);
router.get("/sales-trend", getSalesTrend);
router.get("/profit", getProfit);
router.get("/orders-ops", getOrdersOps);
router.get("/payments", getPayments);
router.get("/refunds", getRefunds);
router.get("/locations", getLocations);
router.get("/discounts", getDiscounts);
router.get("/customers", getCustomers);
router.get("/inventory", getInventory);
router.get("/quick-actions", getQuickActions);

module.exports = router;
