import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    priceCents: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: Number.isInteger
    },
    imageUrl: { type: String, trim: true, default: "" },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

productSchema.index({ isActive: 1, category: 1, name: 1 });
productSchema.index({ isActive: 1, name: 1, createdAt: -1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ vendor: 1, isActive: 1, createdAt: -1 });

export default mongoose.models.Product ||
  mongoose.model("Product", productSchema);
