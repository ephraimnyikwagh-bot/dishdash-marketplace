import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    provider: {
      type: String,
      enum: ["mock", "flutterwave"],
      required: true
    },
    type: { type: String, required: true },
    processedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

export default mongoose.models.WebhookEvent ||
  mongoose.model("WebhookEvent", webhookEventSchema);
