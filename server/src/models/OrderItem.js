import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    imageUrl: { type: String, trim: true, default: "" },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    unitPriceCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    lineTotalCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    }
  },
  { timestamps: true }
);

export default mongoose.models.OrderItem ||
  mongoose.model("OrderItem", orderItemSchema);
