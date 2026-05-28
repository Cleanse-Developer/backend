const { Router } = require("express");
const {
  listUsers,
  getUserTransactions,
  adjustUserPoints,
  getStats,
} = require("../../controllers/admin/loyalty.controller");

const router = Router();

router.get("/users", listUsers);
router.get("/users/:userId/transactions", getUserTransactions);
router.post("/users/:userId/adjust", adjustUserPoints);
router.get("/stats", getStats);

module.exports = router;
