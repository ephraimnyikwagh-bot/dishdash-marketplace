import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import app from "../app.js";
import Cart from "../models/Cart.js";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { processPaymentEvent } from "../services/checkout.js";

const jwtSecret = "test-secret-with-at-least-thirty-two-characters";

describe("checkout, payments, orders, and ledger", () => {
  let replicaSet;

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PLATFORM_FEE_BPS = "1000";
    process.env.NODE_ENV = "test";
    process.env.PAYMENT_PROVIDER = "mock";
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      instanceOpts: [{ launchTimeout: 60000 }]
    });
    await mongoose.connect(replicaSet.getUri("checkout_test"));
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replicaSet) await replicaSet.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Cart.deleteMany({}),
      Dispute.deleteMany({}),
      LedgerEntry.deleteMany({}),
      Order.deleteMany({}),
      OrderItem.deleteMany({}),
      Payment.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
      WebhookEvent.deleteMany({})
    ]);
  });

  async function createUser(role = "buyer") {
    return User.create({
      name: `${role} test`,
      email: `${role}-${new mongoose.Types.ObjectId()}@example.com`,
      passwordHash: "test-hash",
      role
    });
  }

  function tokenFor(user) {
    return jwt.sign({ role: user.role }, jwtSecret, {
      subject: String(user._id),
      issuer: "food-marketplace-api",
      audience: "food-marketplace"
    });
  }

  async function createProduct(vendor, overrides = {}) {
    return Product.create({
      vendor: vendor._id,
      name: "Test meal",
      category: "Meals",
      priceCents: 1000,
      stock: 5,
      ...overrides
    });
  }

  async function putInCart(buyer, product, quantity = 1) {
    await Cart.create({
      buyer: buyer._id,
      items: [{ product: product._id, quantity }]
    });
  }

  async function checkout(buyer, key = `test-key-${new mongoose.Types.ObjectId()}`) {
    return request(app)
      .post("/api/checkout")
      .set("Authorization", `Bearer ${tokenFor(buyer)}`)
      .set("Idempotency-Key", key);
  }

  async function simulate(buyer, paymentId, outcome = "succeeded") {
    return request(app)
      .post(`/api/payments/${paymentId}/simulate`)
      .set("Authorization", `Bearer ${tokenFor(buyer)}`)
      .send({ outcome });
  }

  test("creates a pending order, decrements inventory and clears cart atomically", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 4 });
    await putInCart(buyer, product, 2);

    const response = await checkout(buyer);
    expect(response.status).toBe(201);
    expect(response.body.order.status).toBe("Pending");
    expect(response.body.payment.provider).toBe("mock");
    expect(response.body.payment.status).toBe("pending");
    expect(response.body.payment.reference).toMatch(/^mock_/);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(2);
    expect(await Cart.findOne({ buyer: buyer._id }).then((cart) => cart.items)).toHaveLength(0);
    expect(await OrderItem.countDocuments({ order: response.body.order._id })).toBe(1);
  });

  test("rolls back every database change when the payment provider fails", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 3 });
    await putInCart(buyer, product, 2);

    const checkoutRouter = await import("./checkout.js");
    const testApp = express();
    testApp.use(express.json());
    testApp.use(
      "/api/checkout",
      checkoutRouter.createCheckoutRouter({
        providerFactory: () => ({
          name: "mock",
          createIntent: async () => {
            throw new Error("Provider unavailable");
          }
        })
      })
    );
    testApp.use((error, _request, response, _next) => {
      response.status(500).json({ message: error.message });
    });

    const response = await request(testApp)
      .post("/api/checkout")
      .set("Authorization", `Bearer ${tokenFor(buyer)}`)
      .set("Idempotency-Key", "rollback-checkout-key");

    expect(response.status).toBe(500);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(3);
    expect(await Cart.findOne({ buyer: buyer._id }).then((cart) => cart.items)).toHaveLength(1);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
    expect(await Payment.countDocuments({})).toBe(0);
    expect(await OrderItem.countDocuments({})).toBe(0);
  });

  test("many simultaneous buyers cannot oversell the last item", async () => {
    const vendor = await createUser("vendor");
    const buyers = await Promise.all(
      Array.from({ length: 8 }, () => createUser())
    );
    const product = await createProduct(vendor, { stock: 1 });
    await Promise.all(buyers.map((buyer) => putInCart(buyer, product)));

    const results = await Promise.all(buyers.map((buyer) => checkout(buyer)));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(0);
    expect(await Order.countDocuments({})).toBe(1);
  });

  test("same idempotency key returns the same order without reserving stock twice", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 4 });
    await putInCart(buyer, product, 2);
    const key = "same-idempotency-key";

    const first = await checkout(buyer, key);
    const second = await checkout(buyer, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.order._id).toBe(first.body.order._id);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(2);
  });

  test("success webhook is idempotent and writes a balanced ledger", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, {
      priceCents: 2000,
      stock: 3
    });
    await putInCart(buyer, product, 2);
    const created = await checkout(buyer);
    const reference = created.body.payment.reference;

    const event = {
      providerName: "mock",
      eventId: `mock_${reference}_succeeded`,
      reference,
      outcome: "succeeded"
    };
    const first = await processPaymentEvent(event);
    const duplicate = await processPaymentEvent(event);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(await Order.findById(created.body.order._id).then((order) => order.status)).toBe("Paid");
    expect(await Payment.findById(created.body.payment.id).then((payment) => payment.status)).toBe("succeeded");

    const entries = await LedgerEntry.find({ order: created.body.order._id });
    const debit = entries.filter((entry) => entry.direction === "debit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const credit = entries.filter((entry) => entry.direction === "credit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(entries).toHaveLength(3);
    expect(debit).toBe(credit);
    expect(debit).toBe(4000);
  });

  test("failed payment marks order Failed and restores reserved stock", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 4 });
    await putInCart(buyer, product, 3);
    const created = await checkout(buyer);

    const response = await simulate(buyer, created.body.payment.id, "failed");
    expect(response.status).toBe(200);
    expect(await Order.findById(created.body.order._id).then((order) => order.status)).toBe("Failed");
    expect(await Payment.findById(created.body.payment.id).then((payment) => payment.status)).toBe("failed");
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(4);
    expect(await LedgerEntry.countDocuments({ order: created.body.order._id })).toBe(0);
  });

  test("order lists are scoped to buyer and vendor; details enforce access", async () => {
    const vendor = await createUser("vendor");
    const otherVendor = await createUser("vendor");
    const buyer = await createUser();
    const otherBuyer = await createUser();
    const product = await createProduct(vendor);
    const unrelatedProduct = await createProduct(otherVendor, { name: "Unrelated" });
    await putInCart(buyer, product);
    await putInCart(otherBuyer, unrelatedProduct);
    const ownOrder = await checkout(buyer);
    const otherOrder = await checkout(otherBuyer);

    const buyerList = await request(app)
      .get("/api/orders?page=1&limit=5")
      .set("Authorization", `Bearer ${tokenFor(buyer)}`);
    expect(buyerList.status).toBe(200);
    expect(buyerList.body.orders.map((order) => order._id)).toEqual([
      ownOrder.body.order._id
    ]);

    const vendorList = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${tokenFor(vendor)}`);
    expect(vendorList.status).toBe(200);
    expect(vendorList.body.orders.map((order) => order._id)).toEqual([
      ownOrder.body.order._id
    ]);

    const forbidden = await request(app)
      .get(`/api/orders/${otherOrder.body.order._id}`)
      .set("Authorization", `Bearer ${tokenFor(buyer)}`);
    expect(forbidden.status).toBe(404);
  });

  test("admin ledger integrity endpoint reports balanced totals", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const admin = await createUser("admin");
    const product = await createProduct(vendor, { priceCents: 1000 });
    await putInCart(buyer, product);
    const created = await checkout(buyer);
    await simulate(buyer, created.body.payment.id);

    const response = await request(app)
      .get("/api/ledger/integrity")
      .set("Authorization", `Bearer ${tokenFor(admin)}`);
    expect(response.status).toBe(200);
    expect(response.body.balanced).toBe(true);
    expect(response.body.currencies[0]).toMatchObject({
      currency: "USD",
      debitsCents: 1000,
      creditsCents: 1000,
      balanced: true
    });
  });
});
