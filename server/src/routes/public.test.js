import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import app from "../app.js";
import Product from "../models/Product.js";
import User from "../models/User.js";

describe("public marketplace listings", () => {
  let mongoServer;
  const jwtSecret = "test-secret-with-at-least-thirty-two-characters";

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("carted_public_test"));
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([Product.deleteMany({}), User.deleteMany({})]);
  });

  async function createSeller(email = `seller-${new mongoose.Types.ObjectId()}@example.com`) {
    return User.create({
      name: "Public Seller",
      email,
      passwordHash: "test-hash",
      role: "vendor"
    });
  }

  function tokenFor(user) {
    return `Bearer ${jwt.sign({ role: user.role }, jwtSecret, {
      subject: String(user._id),
      issuer: "carted-api",
      audience: "carted"
    })}`;
  }

  async function createListing(seller, overrides = {}) {
    return Product.create({
      vendor: seller._id,
      title: "Wireless headphones",
      category: "Electronics",
      description: "Bluetooth headphones in great condition",
      priceCents: 1200000,
      quantity: 4,
      stock: 4,
      condition: "Like new",
      location: { state: "Lagos", city: "Ikeja" },
      images: ["https://example.com/headphones.png"],
      imageUrl: "https://example.com/headphones.png",
      ...overrides
    });
  }

  test("featured endpoint caps results and returns no seller personal data", async () => {
    const seller = await createSeller();
    await createListing(seller);
    const response = await request(app).get("/api/public/featured?limit=8");
    expect(response.status).toBe(200);
    expect(response.body.listings).toHaveLength(1);
    expect(response.body.listings[0].seller).toBeUndefined();
    expect(response.body.listings[0].vendor).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(seller.email);
    expect(await request(app).get("/api/public/featured?limit=9").then((res) => res.status)).toBe(400);
  });

  test("public browse filters by category, condition, price, and location", async () => {
    const seller = await createSeller();
    await createListing(seller);
    await createListing(seller, {
      title: "Used tablet",
      name: "Used tablet",
      category: "Phones and Tablets",
      condition: "Used",
      priceCents: 800000,
      location: { state: "Oyo", city: "Ibadan" }
    });

    const response = await request(app)
      .get("/api/public/listings")
      .query({
        category: "Electronics",
        condition: "Like new",
        minPrice: "10000",
        state: "Lagos",
        city: "Ikeja"
      });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].title).toBe("Wireless headphones");
    expect(JSON.stringify(response.body)).not.toContain(seller.email);

    const sorted = await request(app)
      .get("/api/public/listings")
      .query({ sort: "price_asc", page: 1, limit: 2 });
    expect(sorted.body.items.map((item) => item.title)).toEqual([
      "Used tablet",
      "Wireless headphones"
    ]);
  });

  test("seller quantities are bounded and listing updates enforce ownership", async () => {
    const owner = await createSeller();
    const otherSeller = await createSeller();
    const token = tokenFor(owner);
    const valid = {
      title: "Desk lamp",
      category: "Home and Garden",
      price: 22500,
      quantity: 999999,
      condition: "New",
      location: { state: "Lagos", city: "Ikeja" }
    };
    const created = await request(app).post("/api/products")
      .set("Authorization", token).send(valid);
    expect(created.status).toBe(201);
    expect(created.body.product.quantity).toBe(999999);

    const tooMany = await request(app).post("/api/products")
      .set("Authorization", token).send({ ...valid, title: "Over-limit item", quantity: 1000000 });
    expect(tooMany.status).toBe(400);

    const update = await request(app).patch(`/api/products/${created.body.product._id}`)
      .set("Authorization", tokenFor(otherSeller)).send({ ...valid, title: "Stolen update" });
    expect(update.status).toBe(404);
    const saved = await Product.findById(created.body.product._id);
    expect(saved.title).toBe("Desk lamp");
  });

  test("cart quantities cannot exceed the per-item limit", async () => {
    const seller = await createSeller();
    const buyer = await User.create({
      name: "Test Buyer",
      email: `buyer-${new mongoose.Types.ObjectId()}@example.com`,
      passwordHash: "test-hash",
      role: "buyer"
    });
    const listing = await createListing(seller);
    const response = await request(app)
      .post("/api/cart/items")
      .set("Authorization", tokenFor(buyer))
      .send({ productId: listing.id, quantity: 100 });
    expect(response.status).toBe(400);
  });
});
