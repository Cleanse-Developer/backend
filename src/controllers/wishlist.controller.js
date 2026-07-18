const Wishlist = require("../models/Wishlist");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

const POPULATE_PRODUCT = {
  path: "products.product",
  // Include sizes so the storefront can show the real (variant) price, not the
  // base placeholder price, for variant-priced products.
  select: "name slug price compareAtPrice images tag sizes",
};

// GET /api/wishlist
const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id }).populate(
    POPULATE_PRODUCT
  );

  res.json(
    ApiResponse.ok({
      wishlist: wishlist || { products: [] },
    })
  );
});

// POST /api/wishlist/:productId
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  let wishlist = await Wishlist.findOne({ user: req.user._id });

  if (!wishlist) {
    wishlist = new Wishlist({ user: req.user._id, products: [] });
  }

  // Idempotent: if product already exists, return as-is
  const alreadyExists = wishlist.products.some(
    (item) => item.product.toString() === productId
  );

  if (!alreadyExists) {
    wishlist.products.push({ product: productId });
    await wishlist.save();
  }

  await wishlist.populate(POPULATE_PRODUCT);

  res.json(ApiResponse.ok({ wishlist }, "Added to wishlist"));
});

// DELETE /api/wishlist/:productId
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const wishlist = await Wishlist.findOneAndUpdate(
    { user: req.user._id },
    { $pull: { products: { product: productId } } },
    { new: true }
  ).populate(POPULATE_PRODUCT);

  res.json(
    ApiResponse.ok(
      { wishlist: wishlist || { products: [] } },
      "Removed from wishlist"
    )
  );
});

module.exports = { getWishlist, addToWishlist, removeFromWishlist };
