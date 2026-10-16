import mongoose from "mongoose";

const receiptSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true
    },
    receiptNumber: { type: String, required: true, unique: true },
    pdfData: { type: Buffer, required: true },
    issuedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

export default mongoose.models.Receipt ||
  mongoose.model("Receipt", receiptSchema);
