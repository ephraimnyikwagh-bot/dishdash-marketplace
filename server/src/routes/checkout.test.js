import { jest } from "@jest/globals";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Stripe from "stripe";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { createCheckoutRouter, createStripeWebhookRouter } from "./checkout.js";
import Cart from "../models/Cart.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import WebhookEvent from "../models/WebhookEvent.js";

const jwtSecret = "test-secret-with-at-least-thirty-two-characters";
const webhookSecret = "whsec_test_local_webhook_signing_secret";

describe("checkout and Stripe webhook", () => {
  let replicaSet;
  let gateway;
  let app;
  let createdIntents;

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PLATFORM_FEE_BPS = "1000";
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
      LedgerEntry.deleteMany({}),
      Order.deleteMany({}),
      OrderItem.deleteMany({}),
      Payment.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
      WebhookEvent.deleteMany({})
    ]);

    createdIntents = new Map();
    gateway = {
      createPaymentIntent: jest.fn(
        async ({ amountCents, idempotencyKey, metadata }) => {
          if (createdIntents.has(idempotencyKey)) {
            return createdIntents.get(idempotencyKey);
          }
          const intent = {
            id: `pi_test_${createdIntents.size + 1}`,
            client_secret: `pi_test_${createdIntents.size + 1}_secret_test`,
            amount: amountCents,
            amount_received: 0,
            metadata,
            status: "requires_payment_method"
          };
          createdIntents.set(idempotencyKey, intent);
          return intent;
        }
      ),
      retrievePaymentIntent: jest.fn(async (id) => {
        const intent = [...createdIntents.values()].find(
          (item) => item.id === id
        );
        if (!intent) throw new Error("Unknown intent");
        return intent;
      }),
      cancelPaymentIntent: jest.fn(async (id) => {
        const intent = [...createdIntents.values()].find(
          (item) => item.id === id
        );
        if (intent) intent.status = "canceled";
        return intent;
      }),
      constructWebhookEvent: jest.fn((rawBody, signature) =>
        Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
      )
    };

    app = express();
    app.use(
      "/api/webhooks/stripe",
      express.raw({ type: "application/json" }),
      createStripeWebhookRouter({ gatewayFactory: () => gateway })
    );
    app.use(express.json());
    app.use(
      "/api/checkout",
      createCheckoutRouter({ gatewayFactory: () => gateway })
    );
    app.use((error, _request, response, _next) => {
      response.status(error.statusCode || 500).json({ message: error.message });
    });
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

  async function checkout(
    buyer,
    key = `test-key-${new mongoose.Types.ObjectId()}`
  ) {
    return request(app)
      .post("/api/checkout")
      .set("Authorization", `Bearer ${tokenFor(buyer)}`)
      .set("Idempotency-Key", key);
  }

  async function sendWebhook(event) {
    const body = Buffer.from(JSON.stringify(event));
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: body.toString("utf8"),
      secret: webhookSecret
    });
    return request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signature)
      .send(body.toString("utf8"));
  }

  test("creates a pending order and reserves stock; repeats are idempotent", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 4 });
    await putInCart(buyer, product, 2);
    const key = `checkout-${new mongoose.Types.ObjectId()}`;

    const response = await checkout(buyer, key);
    expect(response.status).toBe(201);
    expect(response.body.order.status).toBe("Pending");
    expect(response.body.order.totalCents).toBe(2000);
    expect(response.body.payment.status).toBe("pending");
    expect(response.body.clientSecret).toMatch(/^pi_test_.*_secret_test$/);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(
      2
    );
    expect(
      await Cart.findOne({ buyer: buyer._id }).then((cart) => cart.items)
    ).toHaveLength(0);

    const retry = await checkout(buyer, key);
    expect(retry.status).toBe(200);
    expect(retry.body.order._id).toBe(response.body.order._id);
    expect(gateway.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
  });

  test("snapshots multiple products from one vendor in one transaction", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const productA = await createProduct(vendor, {
      name: "First meal",
      stock: 2
    });
    const productB = await createProduct(vendor, {
      name: "Second meal",
      priceCents: 1500,
      stock: 3
    });
    await Cart.create({
      buyer: buyer._id,
      items: [
        { product: productA._id, quantity: 1 },
        { product: productB._id, quantity: 2 }
      ]
    });

    const response = await checkout(buyer);
    expect(response.status).toBe(201);
    expect(response.body.order.subtotalCents).toBe(4000);
    expect(
      await OrderItem.countDocuments({ order: response.body.order._id })
    ).toBe(2);
    expect(
      await Product.findById(productA._id).then((item) => item.stock)
    ).toBe(1);
    expect(
      await Product.findById(productB._id).then((item) => item.stock)
    ).toBe(1);
  });

  test("can resume a committed checkout after a temporary Stripe failure", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 2 });
    await putInCart(buyer, product);
    const key = `recover-${new mongoose.Types.ObjectId()}`;
    gateway.createPaymentIntent.mockRejectedValueOnce(
      new Error("Temporary Stripe outage")
    );

    const firstAttempt = await checkout(buyer, key);
    expect(firstAttempt.status).toBe(500);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(
      1
    );

    const retry = await checkout(buyer, key);
    expect(retry.status).toBe(200);
    expect(retry.body.clientSecret).toMatch(/^pi_test_.*_secret_test$/);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(
      1
    );
    expect(gateway.createPaymentIntent).toHaveBeenCalledTimes(2);
  });

  test("rejects empty carts, mixed vendors, invalid keys, and non-buyers", async () => {
    const buyer = await createUser();
    const emptyCart = await checkout(buyer);
    expect(emptyCart.status).toBe(400);

    const vendorA = await createUser("vendor");
    const vendorB = await createUser("vendor");
    const productA = await createProduct(vendorA);
    const productB = await createProduct(vendorB, { name: "Other meal" });
    await Cart.create({
      buyer: buyer._id,
      items: [
        { product: productA._id, quantity: 1 },
        { product: productB._id, quantity: 1 }
      ]
    });
    const mixed = await checkout(buyer);
    expect(mixed.status).toBe(400);
    expect(mixed.body.message).toMatch(/one vendor/i);

    const missingKey = await request(app)
      .post("/api/checkout")
      .set("Authorization", `Bearer ${tokenFor(buyer)}`);
    expect(missingKey.status).toBe(400);

    const vendorToken = await createUser("vendor");
    const forbidden = await request(app)
      .post("/api/checkout")
      .set("Authorization", `Bearer ${tokenFor(vendorToken)}`)
      .set("Idempotency-Key", "valid-vendor-key");
    expect(forbidden.status).toBe(403);
  });

  test("does not oversell the last item under simultaneous checkout", async () => {
    const vendor = await createUser("vendor");
    const buyerA = await createUser();
    const buyerB = await createUser();
    const product = await createProduct(vendor, { stock: 1 });
    await Promise.all([putInCart(buyerA, product), putInCart(buyerB, product)]);

    const results = await Promise.all([checkout(buyerA), checkout(buyerB)]);
    expect(results.filter((response) => response.status === 201)).toHaveLength(
      1
    );
    expect(results.filter((response) => response.status === 409)).toHaveLength(
      1
    );
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(
      0
    );
    expect(await Order.countDocuments({})).toBe(1);
  });

  test("signed success webhook records a balanced double-entry ledger once", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, {
      priceCents: 2000,
      stock: 3
    });
    await putInCart(buyer, product, 2);
    const checkoutResponse = await checkout(buyer);
    const intent = [...createdIntents.values()][0];
    intent.amount_received = intent.amount;
    const event = {
      id: "evt_test_payment_succeeded_001",
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: intent }
    };

    const response = await sendWebhook(event);
    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    expect(
      await Order.findById(checkoutResponse.body.order._id).then(
        (order) => order.status
      )
    ).toBe("Paid");
    expect(
      await Payment.findOne({ order: checkoutResponse.body.order._id }).then(
        (payment) => payment.status
      )
    ).toBe("succeeded");

    const entries = await LedgerEntry.find({
      order: checkoutResponse.body.order._id
    });
    const debits = entries
      .filter((entry) => entry.direction === "debit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const credits = entries
      .filter((entry) => entry.direction === "credit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(entries).toHaveLength(3);
    expect(debits).toBe(credits);
    expect(debits).toBe(4000);

    const duplicate = await sendWebhook(event);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(
      await LedgerEntry.countDocuments({
        order: checkoutResponse.body.order._id
      })
    ).toBe(3);
    expect(await WebhookEvent.countDocuments({ eventId: event.id })).toBe(1);
  });

  test("payment cancellation marks the order failed and restores reserved stock", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 4 });
    await putInCart(buyer, product, 3);
    const checkoutResponse = await checkout(buyer);
    const intent = [...createdIntents.values()][0];
    const event = {
      id: "evt_test_payment_failed_001",
      object: "event",
      type: "payment_intent.canceled",
      data: { object: intent }
    };

    const response = await sendWebhook(event);
    expect(response.status).toBe(200);
    expect(
      await Order.findById(checkoutResponse.body.order._id).then(
        (order) => order.status
      )
    ).toBe("Failed");
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(
      4
    );
    expect(
      await LedgerEntry.countDocuments({
        order: checkoutResponse.body.order._id
      })
    ).toBe(0);
  });

  test("a failed payment attempt remains retryable without releasing stock", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser();
    const product = await createProduct(vendor, { stock: 4 });
    await putInCart(buyer, product, 2);
    const checkoutResponse = await checkout(buyer);
    const intent = [...createdIntents.values()][0];
    const event = {
      id: "evt_test_payment_attempt_failed_001",
      object: "event",
      type: "payment_intent.payment_failed",
      data: { object: intent }
    };

    const response = await sendWebhook(event);
    expect(response.status).toBe(200);
    expect(
      await Order.findById(checkoutResponse.body.order._id).then(
        (order) => order.status
      )
    ).toBe("Pending");
    expect(
      await Payment.findOne({ order: checkoutResponse.body.order._id }).then(
        (payment) => payment.status
      )
    ).toBe("pending");
    expect(await Product.findById(product._id).then((item) => item.stock)).toBe(
      2
    );
  });

  test("rejects an invalid Stripe webhook signature", async () => {
    const response = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "invalid")
      .send(JSON.stringify({ id: "evt_invalid" }));
    expect(response.status).toBe(400);
  });
});
