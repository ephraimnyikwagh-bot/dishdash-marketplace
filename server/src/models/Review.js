import mongoose from "mongoose";

const reviewReportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
      index: true
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    comment: { type: String, trim: true, maxlength: 500, default: "" },
    reply: { type: String, trim: true, maxlength: 500, default: "" },
    hidden: { type: Boolean, default: false, index: true },
    reports: { type: [reviewReportSchema], default: [] }
  },
  { timestamps: true }
);

reviewSchema.index({ seller: 1, hidden: 1, createdAt: -1 });

export default mongoose.models.Review || mongoose.model("Review", reviewSchema);
