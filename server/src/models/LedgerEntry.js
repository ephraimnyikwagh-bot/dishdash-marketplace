import mongoose from "mongoose";

const ledgerEntrySchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true
    },
    account: {
      type: String,
      enum: ["buyer_clearing", "vendor_payable", "platform_revenue"],
      required: true
    },
    direction: { type: String, enum: ["debit", "credit"], required: true },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    currency: { type: String, required: true, uppercase: true, default: "USD" },
    idempotencyKey: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ order: 1, createdAt: 1 });

export default mongoose.models.LedgerEntry ||
  mongoose.model("LedgerEntry", ledgerEntrySchema);
