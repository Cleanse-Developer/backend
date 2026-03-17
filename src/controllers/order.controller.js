const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { createOrderId } = require("../services/order.service");
const { calculatePricing } = require("../services/pricing.service");
const { awardPoints } = require("../services/loyalty.service");
const { parsePhone, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes",
};

// POST /api/orders — place order (COD only; Razorpay handled in payment controller)
const placeOrder = asyncHandler(async (req, res) => {
  const {
    shippingInfo,
    billingInfo,
    billingSameAsShipping = true,
    paymentMethod,
    couponCode,
    giftWrap,
    giftMessage,
  } = req.body;

  if (paymentMethod !== "cod") {
    throw ApiError.badRequest(
      "Only COD orders can be placed through this endpoint. Use the payment API for Razorpay."
    );
  }

  // Normalise phone in shippingInfo
  if (shippingInfo?.phone) {
    const parsedPhone = parsePhone(shippingInfo.phone);
    if (parsedPhone) {
      shippingInfo.phone = parsedPhone.number;
      shippingInfo.countryCode = shippingInfo.countryCode || parsedPhone.countryCode || DEFAULT_COUNTRY_CODE;
    }
  }

  // Get user's cart
  const cart = await Cart.findOne({ user: req.user._id }).populate(POPULATE_PRODUCT);

  if (!cart || !cart.items.length) {
    throw ApiError.badRequest("Cart is empty");
  }

  // Calculate pricing
  const pricing = await calculatePricing(cart, couponCode, req.user._id, giftWrap);

  // Generate order ID
  const orderId = await createOrderId();

  // Build order items
  const orderItems = cart.items.map((item) => {
    const primaryImage = item.product.images?.find((img) => img.isPrimary);
    return {
      product: item.product._id,
      name: item.product.name,
      price: item.product.price,
      quantity: item.quantity,
      selectedSize: item.selectedSize,
      image: primaryImage?.url || item.product.images?.[0]?.url || "",
    };
  });

  // Create order
  const order = await Order.create({
    orderId,
    user: req.user._id,
    items: orderItems,
    shippingAddress: shippingInfo,
    billingAddress: billingSameAsShipping ? shippingInfo : billingInfo,
    billingSameAsShipping,
    payment: {
      method: "cod",
      status: "pending",
    },
    pricing: {
      subtotal: pricing.subtotal,
      bundleDiscounts: pricing.bundleDiscounts,
      bundleDiscountTotal: pricing.bundleDiscountTotal,
      tierDiscount: pricing.tierDiscount,
      tierPercent: pricing.tierPercent,
      tierLabel: pricing.tierLabel,
      couponDiscount: pricing.couponDiscount,
      couponCode: pricing.couponCode,
      shippingCost: pricing.shippingCost,
      giftWrapCost: pricing.giftWrapCost,
      total: pricing.total,
    },
    giftWrap: giftWrap || false,
    giftMessage,
    contactEmail: shippingInfo.email,
    contactPhone: shippingInfo.phone,
    status: "pending",
    loyaltyPointsEarned: pricing.loyaltyPoints,
  });

  // Update coupon usage if a coupon was applied
  if (pricing.couponCode) {
    await Coupon.findOneAndUpdate(
      { code: pricing.couponCode },
      {
        $inc: { usageCount: 1 },
        $push: { usedBy: { user: req.user._id, usedAt: new Date() } },
      }
    );
  }

  // Clear cart
  cart.items = [];
  cart.giftWrap = false;
  cart.giftMessage = "";
  await cart.save();

  // Award loyalty points
  await awardPoints(
    req.user._id,
    pricing.loyaltyPoints,
    order._id,
    `Earned ${pricing.loyaltyPoints} points from order ${orderId}`
  );

  res.status(201).json(ApiResponse.created({ order }, "Order placed successfully"));
});

// GET /api/orders/my-orders
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .populate({
      path: "items.product",
      select: "name slug images",
    });

  res.json(ApiResponse.ok({ orders }));
});

// POST /api/orders/:orderId/return
const requestReturn = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const { orderId } = req.params;

  const order = await Order.findOne({ orderId, user: req.user._id });

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  if (order.status !== "delivered") {
    throw ApiError.badRequest("Returns can only be requested for delivered orders");
  }

  if (order.returnRequest.requested) {
    throw ApiError.badRequest("A return request has already been submitted for this order");
  }

  order.returnRequest = {
    requested: true,
    reason,
    status: "requested",
    requestedAt: new Date(),
  };
  order.status = "return_requested";

  await order.save();

  res.json(ApiResponse.ok({ order }, "Return request submitted successfully"));
});

// POST /api/orders/:orderId/reorder
const reorder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findOne({ orderId, user: req.user._id });

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  let cart = await Cart.findOne({ user: req.user._id });

  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  // Add all items from the order to the cart
  for (const item of order.items) {
    const existingIndex = cart.items.findIndex(
      (cartItem) =>
        cartItem.product.toString() === item.product.toString() &&
        cartItem.selectedSize === item.selectedSize
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += item.quantity;
    } else {
      cart.items.push({
        product: item.product,
        quantity: item.quantity,
        selectedSize: item.selectedSize,
      });
    }
  }

  await cart.save();
  await cart.populate(POPULATE_PRODUCT);

  res.json(ApiResponse.ok({ cart }, "Items added to cart"));
});

module.exports = { placeOrder, getMyOrders, requestReturn, reorder };
