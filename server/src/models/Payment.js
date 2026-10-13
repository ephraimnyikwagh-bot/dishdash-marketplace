import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true
    },
    provider: {
      type: String,
      enum: ["stripe", "flutterwave"],
      required: true
    },
    providerIntentId: { type: String, unique: true, sparse: true },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    currency: { type: String, required: true, uppercase: true, default: "USD" },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "refunded"],
      default: "pending",
      index: true
    },
    idempotencyKey: { type: String, required: true, unique: true },
    confirmedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

paymentSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.Payment ||
  mongoose.model("Payment", paymentSchema);
