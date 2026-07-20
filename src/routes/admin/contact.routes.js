const { Router } = require("express");
const {
  listContacts,
  updateStatus,
  deleteContact,
} = require("../../controllers/admin/contact.controller");

const router = Router();

router.get("/", listContacts);
router.patch("/:id/status", updateStatus);
router.delete("/:id", deleteContact);

module.exports = router;
