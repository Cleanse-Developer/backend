const mongoose = require("mongoose");
const agenda = require("../config/agenda");
const PaymentSession = require("../models/PaymentSession");
const { releaseStock } = require("../services/stock.service");
const {
  createOrderFromSession,
  postOrderActions,
} = require("../services/checkout.service");
const razorpayService = require("../services/razorpay.service");

/**
 * Expire a payment session: check with Razorpay whether the payment was
 * actually captured. If paid, create the order (safety net). If not, release
 * reserved stock.
 */
agenda.define("expire-payment-session", async (job) => {
  const { sessionId } = job.attrs.data;

  const session = await PaymentSession.findById(sessionId);
  if (!session || session.status !== "pending") return;

  // Check with Razorpay: was the payment actually captured?
  let rzpOrder;
  try {
    rzpOrder = await razorpayService.fetchOrder(session.razorpayOrderId);
  } catch (err) {
    // Razorpay API error -- retry on next Agenda attempt
    throw err;
  }

  if (rzpOrder.status === "paid") {
    // Payment captured but both confirm and webhook missed.
    // Create the order from the frozen session snapshot.
    const mongoSession = await mongoose.startSession();
    try {
      mongoSession.startTransaction();

      // Atomic lock: only process if still pending
      const locked = await PaymentSession.findOneAndUpdate(
        { _id: session._id, status: "pending" },
        { $set: { status: "processing" } },
        { new: true, session: mongoSession }
      );

      if (!locked) {
        await mongoSession.abortTransaction();
        return;
      }

      // Extract payment ID from Razorpay payments for this order
      let razorpayPaymentId;
      try {
        const razorpay = require("../config/razorpay")();
        const orderPayments = await razorpay.orders.fetchPayments(
          session.razorpayOrderId
        );
        const captured = orderPayments.items?.find(
          (p) => p.status === "captured"
        );
        razorpayPaymentId = captured?.id;
      } catch {
        // Fall back: order was paid but we can't get payment ID.
        // Still create the order -- payment ID can be reconciled later.
      }

      const order = await createOrderFromSession(
        locked,
        {
          method: "razorpay",
          razorpayOrderId: session.razorpayOrderId,
          razorpayPaymentId: razorpayPaymentId || undefined,
        },
        mongoSession
      );

      await mongoSession.commitTransaction();
      await postOrderActions(order, locked);
    } catch (err) {
      await mongoSession.abortTransaction();
      // Revert to pending for next retry
      await PaymentSession.findByIdAndUpdate(session._id, {
        status: "pending",
      });
      throw err;
    } finally {
      mongoSession.endSession();
    }
    return;
  }

  // Payment was never completed or failed. Release stock.
  await releaseStock(session.stockReservations);

  session.status = rzpOrder.status === "attempted" ? "failed" : "expired";
  await session.save();
});

/**
 * Purge completed/cancelled Agenda jobs older than 7 days.
 */
agenda.define("purge-old-jobs", async () => {
  await agenda._collection.deleteMany({
    lastFinishedAt: {
      $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
  });
});
