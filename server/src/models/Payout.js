import mongoose from "mongoose";

const payoutSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger
    },
    status: {
      type: String,
      enum: ["Requested", "Paid out"],
      default: "Requested",
      index: true
    },
    idempotencyKey: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

payoutSchema.index({ seller: 1, createdAt: -1 });

export default mongoose.models.Payout || mongoose.model("Payout", payoutSchema);
