const { Router } = require("express");
const {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} = require("../controllers/wishlist.controller");

const router = Router();

// GET /api/wishlist — get user's wishlist
router.get("/", getWishlist);

// POST /api/wishlist/:productId — add product to wishlist
router.post("/:productId", addToWishlist);

// DELETE /api/wishlist/:productId — remove product from wishlist
router.delete("/:productId", removeFromWishlist);

module.exports = router;
