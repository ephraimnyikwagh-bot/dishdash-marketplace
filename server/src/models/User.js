import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["buyer", "vendor", "courier", "admin"],
      required: true
    },
    phone: { type: String, trim: true, maxlength: 30 },
    isActive: { type: Boolean, default: true },
    ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
    ratingCount: { type: Number, min: 0, default: 0 },
    ratingSum: { type: Number, min: 0, default: 0 },
    walletVersion: { type: Number, min: 0, default: 0 }
  },
  { timestamps: true }
);

userSchema.index({ role: 1, isActive: 1 });

userSchema.set("toJSON", {
  transform(_document, value) {
    delete value.passwordHash;
    delete value.__v;
    return value;
  }
});

export default mongoose.models.User || mongoose.model("User", userSchema);
