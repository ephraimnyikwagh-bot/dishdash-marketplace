import mongoose from "mongoose";

export const listingCategories = [
  "Phones and Tablets",
  "Electronics",
  "Fashion",
  "Home and Garden",
  "Vehicles",
  "Beauty and Health",
  "Sports and Fitness",
  "Books and Education"
];
export const listingConditions = ["New", "Like new", "Used"];
export const nigerianStates = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

const productSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    title: { type: String, trim: true, maxlength: 160 },
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
    quantity: { type: Number, min: 0, validate: Number.isInteger },
    imageUrl: { type: String, trim: true, default: "" },
    images: {
      type: [{ type: String, trim: true, maxlength: 2048 }],
      default: [],
      validate: (images) => images.length <= 5
    },
    category: { type: String, required: true, enum: listingCategories },
    condition: { type: String, required: true, enum: listingConditions, default: "Used" },
    location: {
      state: { type: String, required: true, enum: nigerianStates, default: "Lagos" },
      city: { type: String, required: true, trim: true, maxlength: 100, default: "Lagos" }
    },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

productSchema.virtual("price")
  .get(function getPriceInNaira() {
    return this.priceCents / 100;
  })
  .set(function setPriceInNaira(value) {
    this.priceCents = Math.round(Number(value) * 100);
  });

productSchema.pre("validate", function syncListingAliases(next) {
  if (!this.name && this.title) this.name = this.title;
  if (!this.title && this.name) this.title = this.name;
  if (this.stock == null && this.quantity != null) this.stock = this.quantity;
  if (this.quantity == null && this.stock != null) this.quantity = this.stock;
  if (this.images?.length && !this.imageUrl) this.imageUrl = this.images[0];
  if (!this.images?.length && this.imageUrl) this.images = [this.imageUrl];
  next();
});

productSchema.pre("findOneAndUpdate", function syncUpdatedListingAliases() {
  const update = this.getUpdate();
  const fields = update.$set || update;
  if (fields.title && !fields.name) fields.name = fields.title;
  if (fields.name && !fields.title) fields.title = fields.name;
  if (fields.quantity != null && fields.stock == null) fields.stock = fields.quantity;
  if (fields.stock != null && fields.quantity == null) fields.quantity = fields.stock;
  if (Array.isArray(fields.images) && fields.imageUrl == null) {
    fields.imageUrl = fields.images[0] || "";
  }
  if (fields.imageUrl && fields.images == null) fields.images = [fields.imageUrl];
  if (update.$set) update.$set = fields;
  this.setUpdate(update);
});

productSchema.index({ isActive: 1, category: 1, name: 1 });
productSchema.index({ isActive: 1, name: 1, createdAt: -1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ vendor: 1, isActive: 1, createdAt: -1 });
productSchema.index({ isActive: 1, condition: 1, "location.state": 1, createdAt: -1 });
productSchema.index({ isActive: 1, priceCents: 1, createdAt: -1 });
productSchema.index({ isActive: 1, "location.state": 1, "location.city": 1, createdAt: -1 });
productSchema.index({ isActive: 1, stock: 1, createdAt: -1 });

export default mongoose.models.Product ||
  mongoose.model("Product", productSchema);
