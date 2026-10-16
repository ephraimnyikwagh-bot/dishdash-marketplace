import mongoose from "mongoose";

const orderStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "Pending",
        "Paid",
        "Shipped",
        "Delivered",
        "Failed",
        "Cancelled",
        "Refunded"
      ],
      required: true
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    changedByRole: {
      type: String,
      enum: ["buyer", "vendor", "courier", "admin", "system"],
      required: true
    },
    changedAt: { type: Date, required: true, default: Date.now }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    courier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    status: {
      type: String,
      enum: [
        "Pending",
        "Paid",
        "Shipped",
        "Delivered",
        "Failed",
        "Cancelled",
        "Refunded"
      ],
      default: "Pending",
      index: true
    },
    statusHistory: { type: [orderStatusHistorySchema], default: [] },
    subtotalCents: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger
    },
    platformFeeCents: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger
    },
    totalCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    currency: { type: String, required: true, uppercase: true, default: "USD" },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null
    },
    idempotencyKey: { type: String, unique: true, sparse: true }
  },
  { timestamps: true }
);

orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ courier: 1, status: 1 });

export default mongoose.models.Order || mongoose.model("Order", orderSchema);
