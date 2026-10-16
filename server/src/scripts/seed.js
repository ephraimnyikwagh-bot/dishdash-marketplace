import "dotenv/config";
import bcrypt from "bcryptjs";
import { access, readFile } from "node:fs/promises";
import mongoose from "mongoose";
import path from "node:path";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { connectDatabase } from "../config/database.js";
import { storeProductImage } from "../services/imageStorage.js";

const demoPassword = "DishDashDemo2026!";
const demoUsers = [
  { name: "Demo Buyer", email: "buyer@dishdash.demo", role: "buyer" },
  { name: "Demo Vendor", email: "vendor@dishdash.demo", role: "vendor" },
  { name: "Demo Courier", email: "courier@dishdash.demo", role: "courier" },
  { name: "Demo Admin", email: "admin@dishdash.demo", role: "admin" }
];
const seedImageDirectory = new URL("../../seed-images/", import.meta.url);
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

const dishes = [
  {
    name: "Smoky Jollof Rice",
    description: "Party-style Nigerian jollof rice with a smoky tomato-pepper base.",
    priceCents: 1250,
    stock: 12,
    category: "Rice",
    imageUrl: "https://placehold.co/600x400?text=Smoky+Jollof+Rice"
  },
  {
    name: "Beef Suya",
    description: "Spiced grilled beef skewers served with onions and tomatoes.",
    priceCents: 1800,
    stock: 9,
    category: "Grills",
    imageUrl: "https://placehold.co/600x400?text=Beef+Suya"
  },
  {
    name: "Pounded Yam with Egusi",
    description: "Smooth pounded yam with melon-seed soup, leafy greens, and assorted meat.",
    priceCents: 2200,
    stock: 7,
    category: "Swallow and Soup",
    imageUrl: "https://placehold.co/600x400?text=Pounded+Yam+and+Egusi"
  },
  {
    name: "Goat Meat Pepper Soup",
    description: "A warming broth of goat meat, scent leaf, and traditional pepper-soup spices.",
    priceCents: 1600,
    stock: 8,
    category: "Soups",
    imageUrl: "https://placehold.co/600x400?text=Goat+Pepper+Soup"
  },
  {
    name: "Steamed Moi Moi",
    description: "Tender steamed bean pudding blended with peppers and onions.",
    priceCents: 700,
    stock: 15,
    category: "Sides",
    imageUrl: "https://placehold.co/600x400?text=Steamed+Moi+Moi"
  },
  {
    name: "Grilled Tilapia with Plantain",
    description: "Whole pepper-marinated tilapia grilled and served with ripe fried plantain.",
    priceCents: 2500,
    stock: 5,
    category: "Grills",
    imageUrl: "https://placehold.co/600x400?text=Tilapia+and+Plantain"
  },
  {
    name: "Efo Riro with Assorted Meat",
    description: "Yoruba-style spinach stew simmered with peppers, palm oil, and assorted meat.",
    priceCents: 1900,
    stock: 6,
    category: "Soups",
    imageUrl: "https://placehold.co/600x400?text=Efo+Riro"
  },
  {
    name: "Nigerian Fried Rice",
    description: "Seasoned fried rice with mixed vegetables, chicken, and a side of coleslaw.",
    priceCents: 1400,
    stock: 14,
    category: "Rice",
    imageUrl: "https://placehold.co/600x400?text=Nigerian+Fried+Rice"
  },
  {
    name: "Chicken Shawarma",
    description: "Grilled chicken, vegetables, and creamy sauce wrapped in soft flatbread.",
    priceCents: 1200,
    stock: 11,
    category: "Wraps",
    imageUrl: "https://placehold.co/600x400?text=Chicken+Shawarma"
  },
  {
    name: "Akara with Pap",
    description: "Crisp black-eyed-pea fritters served with smooth warm ogi.",
    priceCents: 850,
    stock: 18,
    category: "Breakfast",
    imageUrl: "https://placehold.co/600x400?text=Akara+with+Pap"
  }
];

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data when NODE_ENV is production.");
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required to seed demo data.");
  }

  await connectDatabase();
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const usersByRole = {};

  for (const user of demoUsers) {
    const savedUser = await User.findOneAndUpdate(
      { email: user.email },
      {
        $set: {
          ...user,
          passwordHash,
          isActive: true
        }
      },
      { upsert: true, new: true, runValidators: true }
    );
    usersByRole[user.role] = savedUser;
  }

  const vendor = usersByRole.vendor;
  for (const dish of dishes) {
    const slug = dish.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const product = await Product.findOneAndUpdate(
      { vendor: vendor._id, name: dish.name },
      { $set: { ...dish, vendor: vendor._id, isActive: true } },
      { upsert: true, new: true, runValidators: true }
    );
    for (const extension of Object.keys(mimeTypes)) {
      const filename = `${slug}${extension}`;
      const imagePath = new URL(filename, seedImageDirectory);
      try {
        await access(imagePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      product.imageUrl = await storeProductImage({
        buffer: await readFile(imagePath),
        mimetype: mimeTypes[path.extname(filename)],
        productId: product.id,
        key: `seed-${product.id}-${slug}`
      });
      await product.save();
      break;
    }
  }

  console.info(
    `Seed complete: ${demoUsers.length} demo users and ${dishes.length} menu items are ready.`
  );
  console.info(`Shared demo password: ${demoPassword}`);
}

try {
  await seed();
} catch (error) {
  console.error("Demo seed failed:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
