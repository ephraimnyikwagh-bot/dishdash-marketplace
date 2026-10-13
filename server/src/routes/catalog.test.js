import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import app from "../app.js";
import Product from "../models/Product.js";
import User from "../models/User.js";

describe("catalog and cart routes", () => {
  let mongoServer;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret-with-at-least-thirty-two-characters";
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("food_marketplace_test"));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Product.deleteMany({});
  });

  function createToken(user) {
    return jwt.sign(
      { role: user.role, sub: String(user._id) },
      process.env.JWT_SECRET,
      {
        issuer: "food-marketplace-api",
        audience: "food-marketplace"
      }
    );
  }

  async function createUser(overrides = {}) {
    return User.create({
      name: "Test User",
      email: `user-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      passwordHash: "hashed-password",
      role: "buyer",
      ...overrides
    });
  }

  test("vendor can create and manage their inventory", async () => {
    const vendor = await createUser({ role: "vendor", name: "Vendor One" });
    const token = `Bearer ${createToken(vendor)}`;

    const createResponse = await request(app)
      .post("/api/products")
      .set("Authorization", token)
      .send({
        name: "Veggie Burger",
        category: "Meals",
        description: "Healthy and filling",
        priceCents: 1299,
        stock: 8,
        imageUrl: "https://example.com/burger.png"
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.product.name).toBe("Veggie Burger");

    const updateResponse = await request(app)
      .patch(`/api/products/${createResponse.body.product._id}`)
      .set("Authorization", token)
      .send({
        name: "Veggie Burger Deluxe",
        category: "Meals",
        description: "Now with avocado",
        priceCents: 1499,
        stock: 6,
        imageUrl: "https://example.com/burger-deluxe.png"
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.product.name).toBe("Veggie Burger Deluxe");

    const listResponse = await request(app)
      .get("/api/products/mine")
      .set("Authorization", token);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.products).toHaveLength(1);
    expect(listResponse.body.products[0].stock).toBe(6);
  });

  test("buyer can browse and search products with pagination", async () => {
    const vendor = await createUser({ role: "vendor", name: "Vendor Two" });
    const buyer = await createUser({ role: "buyer", name: "Buyer One" });
    const buyerToken = `Bearer ${createToken(buyer)}`;

    await Product.create([
      {
        vendor: vendor._id,
        name: "Veggie Wrap",
        category: "Lunch",
        description: "Crisp veggies",
        priceCents: 850,
        stock: 10,
        imageUrl: "https://example.com/wrap.png"
      },
      {
        vendor: vendor._id,
        name: "Chicken Bowl",
        category: "Meals",
        description: "High protein",
        priceCents: 1450,
        stock: 7,
        imageUrl: "https://example.com/bowl.png"
      }
    ]);

    const response = await request(app)
      .get("/api/products")
      .set("Authorization", buyerToken)
      .query({ q: "veggie", page: 1, limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.totalPages).toBe(1);
    expect(response.body.items[0].name).toMatch(/veggie/i);
  });

  test("buyer can add, update, and remove cart items", async () => {
    const vendor = await createUser({ role: "vendor", name: "Vendor Three" });
    const buyer = await createUser({ role: "buyer", name: "Buyer Two" });
    const buyerToken = `Bearer ${createToken(buyer)}`;

    const product = await Product.create({
      vendor: vendor._id,
      name: "Sushi Box",
      category: "Dinner",
      description: "Fresh and light",
      priceCents: 2000,
      stock: 12,
      imageUrl: "https://example.com/sushi.png"
    });

    const addResponse = await request(app)
      .post("/api/cart/items")
      .set("Authorization", buyerToken)
      .send({ productId: String(product._id), quantity: 2 });

    expect(addResponse.status).toBe(201);
    expect(addResponse.body.item.quantity).toBe(2);

    const updateResponse = await request(app)
      .patch(`/api/cart/items/${product._id}`)
      .set("Authorization", buyerToken)
      .send({ quantity: 4 });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.items[0].quantity).toBe(4);
    expect(updateResponse.body.totalCents).toBe(8000);

    const removeResponse = await request(app)
      .delete(`/api/cart/items/${product._id}`)
      .set("Authorization", buyerToken);

    expect(removeResponse.status).toBe(200);
    expect(removeResponse.body.items).toHaveLength(0);
  });
});
