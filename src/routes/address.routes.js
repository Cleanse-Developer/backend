const { Router } = require("express");
const {
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
} = require("../controllers/address.controller");
const { addressRules, addressPatchRules } = require("../validators/address.validator");
const validate = require("../middleware/validate");

const router = Router();

// GET /api/addresses — list all addresses
router.get("/", listAddresses);

// POST /api/addresses — add new address
router.post("/", addressRules, validate, addAddress);

// PATCH /api/addresses/:id — update address (all fields optional)
router.patch("/:id", addressPatchRules, validate, updateAddress);

// DELETE /api/addresses/:id — delete address
router.delete("/:id", deleteAddress);

module.exports = router;
