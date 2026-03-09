const { Router } = require("express");
const {
  listTickets,
  getTicket,
  updateTicket,
} = require("../../controllers/admin/ticket.controller");

const router = Router();

router.get("/", listTickets);
router.get("/:id", getTicket);
router.patch("/:id", updateTicket);

module.exports = router;
