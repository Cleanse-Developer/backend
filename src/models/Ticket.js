const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    type: {
      type: String,
      enum: ["return", "refund", "general", "product", "shipping"],
    },
    subject: { type: String, required: true },
    description: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    messages: [
      {
        sender: { type: String, enum: ["customer", "support"] },
        text: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

ticketSchema.index({ status: 1, priority: -1 });
ticketSchema.index({ user: 1 });

// Auto-generate ticketId as TK-YYYY-XXXX if not set
ticketSchema.pre("save", function (next) {
  if (!this.ticketId) {
    const year = new Date().getFullYear();
    const random = Math.floor(1000 + Math.random() * 9000);
    this.ticketId = `TK-${year}-${random}`;
  }
  next();
});

module.exports = mongoose.model("Ticket", ticketSchema);
