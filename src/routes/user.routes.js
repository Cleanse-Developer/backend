const { Router } = require("express");
const {
  getProfile,
  updateProfile,
  updatePreferences,
} = require("../controllers/user.controller");
const {
  updateProfileRules,
  updatePreferencesRules,
} = require("../validators/user.validator");
const validate = require("../middleware/validate");

const router = Router();

// GET /api/user/profile — get user profile
router.get("/profile", getProfile);

// PATCH /api/user/profile — update profile fields
router.patch("/profile", updateProfileRules, validate, updateProfile);

// PATCH /api/user/preferences — update notification preferences
router.patch("/preferences", updatePreferencesRules, validate, updatePreferences);

module.exports = router;
