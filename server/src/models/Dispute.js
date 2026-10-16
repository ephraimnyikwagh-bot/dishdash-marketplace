import mongoose from "mongoose";

const disputeSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    origin: {
      type: String,
      enum: ["buyer", "system"],
      default: "buyer",
      required: true
    },
    status: {
      type: String,
      enum: ["Open", "Under review", "Resolved", "Refunded"],
      default: "Open",
      index: true
    },
    resolution: { type: String, trim: true, maxlength: 2000, default: "" },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

disputeSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.Dispute ||
  mongoose.model("Dispute", disputeSchema);
