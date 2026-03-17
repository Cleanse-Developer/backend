const crypto = require("crypto");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const razorpayService = require("../services/razorpay.service");
const { createOrderId } = require("../services/order.service");
const { calculatePricing } = require("../services/pricing.service");
const { awardPoints } = require("../services/loyalty.service");
const { parsePhone, DEFAULT_COUNTRY_CODE } = require("../utils/phoneUtils");

const POPULATE_PRODUCT = {
  path: "items.product",
  select: "name slug price images tag sizes",
};

// POST /api/payments/razorpay/create
const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { shippingInfo, billingInfo, billingSameAsShipping, couponCode, giftWrap, giftMessage } =
    req.body;

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

  // Create Razorpay order (amount in paise)
  const amountInPaise = Math.round(pricing.total * 100);
  const receipt = `rcpt_${req.user._id}_${Date.now()}`;

  const razorpayOrder = await razorpayService.createOrder(
    amountInPaise,
    "INR",
    receipt
  );

  res.json(
    ApiResponse.ok({
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: "INR",
      pricing,
    })
  );
});

// POST /api/payments/razorpay/verify
const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    shippingInfo,
    billingInfo,
    billingSameAsShipping = true,
    couponCode,
    giftWrap,
    giftMessage,
  } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest("Payment verification details are required");
  }

  // Normalise phone in shippingInfo
  if (shippingInfo?.phone) {
    const parsedPhone = parsePhone(shippingInfo.phone);
    if (parsedPhone) {
      shippingInfo.phone = parsedPhone.number;
      shippingInfo.countryCode = shippingInfo.countryCode || parsedPhone.countryCode || DEFAULT_COUNTRY_CODE;
    }
  }

  // Verify signature
  const isValid = razorpayService.verifyPayment(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!isValid) {
    throw ApiError.badRequest("Payment verification failed");
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
      method: "razorpay",
      razorpayOrderId,
      razorpayPaymentId,
      status: "paid",
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
    status: "confirmed",
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

  res.json(ApiResponse.created({ order }, "Order placed successfully"));
});

// POST /api/payments/webhook
const handleWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!signature || !webhookSecret) {
      return res.status(400).json({ error: "Missing signature or secret" });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = req.body.event;
    const payload = req.body.payload;

    if (event === "payment.captured") {
      const paymentId = payload.payment.entity.id;
      const razorpayOrderId = payload.payment.entity.order_id;

      await Order.findOneAndUpdate(
        { "payment.razorpayOrderId": razorpayOrderId },
        {
          "payment.razorpayPaymentId": paymentId,
          "payment.status": "paid",
          status: "confirmed",
        }
      );
    }

    if (event === "payment.failed") {
      const razorpayOrderId = payload.payment.entity.order_id;

      await Order.findOneAndUpdate(
        { "payment.razorpayOrderId": razorpayOrderId },
        {
          "payment.status": "failed",
          status: "cancelled",
        }
      );
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

module.exports = { createRazorpayOrder, verifyRazorpayPayment, handleWebhook };
