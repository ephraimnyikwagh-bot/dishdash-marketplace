import mongoose from "mongoose";

const ledgerEntrySchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    account: {
      type: String,
      enum: [
        "buyer_payment",
        "escrow",
        "seller_payable",
        "platform_fee_revenue",
        "seller_payout"
      ],
      required: true
    },
    direction: { type: String, enum: ["debit", "credit"], required: true },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    currency: { type: String, required: true, uppercase: true, default: "NGN" },
    idempotencyKey: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ order: 1, createdAt: 1 });
ledgerEntrySchema.index({ createdAt: -1 });

export default mongoose.models.LedgerEntry ||
  mongoose.model("LedgerEntry", ledgerEntrySchema);
