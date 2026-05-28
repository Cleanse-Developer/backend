const Product = require("../models/Product");
const ApiError = require("../utils/ApiError");

/**
 * Reserve stock by atomically decrementing Product.sizes[].stock.
 * Must be called within a MongoDB transaction session.
 *
 * @param {Array} items - [{ productId, sizeLabel, quantity }]
 * @param {import("mongoose").ClientSession} mongoSession - Active transaction session
 * @returns {Promise<Array>} Reservation records for PaymentSession.stockReservations
 */
const reserveStock = async (items, mongoSession) => {
  const reservations = [];

  for (const { productId, sizeLabel, quantity } of items) {
    const result = await Product.findOneAndUpdate(
      {
        _id: productId,
        "sizes.label": sizeLabel,
        "sizes.stock": { $gte: quantity },
      },
      { $inc: { "sizes.$.stock": -quantity } },
      { new: true, session: mongoSession }
    );

    if (!result) {
      const product = await Product.findById(productId)
        .select("name")
        .lean()
        .session(mongoSession);
      throw ApiError.conflict(
        `Insufficient stock for ${product?.name || "product"} (${sizeLabel})`
      );
    }

    // Recompute totalStock (pre-save hook doesn't fire on findOneAndUpdate)
    await Product.updateOne(
      { _id: productId },
      [{ $set: { totalStock: { $sum: "$sizes.stock" } } }],
      { session: mongoSession }
    );

    reservations.push({ product: productId, sizeLabel, quantity });
  }

  return reservations;
};

/**
 * Release reserved stock by incrementing sizes back.
 * Best-effort (no transaction needed -- rollback scenario).
 *
 * @param {Array} reservations - PaymentSession.stockReservations array
 */
const releaseStock = async (reservations) => {
  if (!reservations || reservations.length === 0) return;

  for (const { product: productId, sizeLabel, quantity } of reservations) {
    await Product.findOneAndUpdate(
      { _id: productId, "sizes.label": sizeLabel },
      { $inc: { "sizes.$.stock": quantity } }
    );

    await Product.updateOne(
      { _id: productId },
      [{ $set: { totalStock: { $sum: "$sizes.stock" } } }]
    );
  }
};

/**
 * Validate that all cart items have sufficient stock.
 * Does NOT decrement -- read-only check for early warning.
 *
 * @param {Array} cartItems - Populated cart items (items[].product must have sizes)
 * @returns {{ valid: boolean, insufficientItems?: Array }}
 */
const validateStock = async (cartItems) => {
  const insufficientItems = [];

  for (const item of cartItems) {
    const product = await Product.findById(item.product._id || item.product)
      .select("name sizes")
      .lean();

    if (!product) {
      insufficientItems.push({
        productId: item.product._id || item.product,
        name: "Unknown product",
        sizeLabel: item.selectedSize,
        requested: item.quantity,
        available: 0,
      });
      continue;
    }

    const sizeLabel = item.selectedSize;
    const sizeEntry = sizeLabel
      ? product.sizes.find((s) => s.label === sizeLabel)
      : product.sizes[0];

    const available = sizeEntry?.stock ?? 0;

    if (available < item.quantity) {
      insufficientItems.push({
        productId: product._id,
        name: product.name,
        sizeLabel: sizeLabel || sizeEntry?.label || "default",
        requested: item.quantity,
        available,
      });
    }
  }

  if (insufficientItems.length > 0) {
    return { valid: false, insufficientItems };
  }

  return { valid: true };
};

module.exports = { reserveStock, releaseStock, validateStock };
