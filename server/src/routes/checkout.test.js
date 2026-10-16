import express from "express";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { io as createSocketClient } from "socket.io-client";
import request from "supertest";
import app from "../app.js";
import Cart from "../models/Cart.js";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import Receipt from "../models/Receipt.js";
import User from "../models/User.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { processPaymentEvent } from "../services/checkout.js";
import { initializeRealtime, resetRealtime } from "../services/realtime.js";

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
      Receipt.deleteMany({}),
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
    await Cart.findOneAndUpdate(
      { buyer: buyer._id },
      { $set: { items: [{ product: product._id, quantity }] } },
      { upsert: true, new: true }
    );
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

  async function createPaidOrder() {
    const vendor = await createUser("vendor");
    const buyer = await createUser("buyer");
    const product = await createProduct(vendor);
    await putInCart(buyer, product);
    const checkoutResponse = await checkout(buyer);
    const paymentResponse = await simulate(buyer, checkoutResponse.body.payment.id);
    expect(paymentResponse.status).toBe(200);
    return { vendor, buyer, orderId: checkoutResponse.body.order._id };
  }

  async function updateOrderStatus(user, orderId, status) {
    return request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${tokenFor(user)}`)
      .send({ status });
  }

  function connectSocket(url, user) {
    return new Promise((resolve, reject) => {
      const socket = createSocketClient(url, {
        auth: { token: tokenFor(user) },
        forceNew: true,
        transports: ["websocket"]
      });
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
  }

  function waitForUpdate(socket, orderId, status) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("order:updated", handleUpdate);
        reject(new Error(`Timed out waiting for ${status} order update`));
      }, 3000);
      function handleUpdate(update) {
        if (update.orderId !== String(orderId) || update.status !== status) return;
        clearTimeout(timer);
        socket.off("order:updated", handleUpdate);
        resolve(update);
      }
      socket.on("order:updated", handleUpdate);
    });
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
    await simulate(buyer, ownOrder.body.payment.id);

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

  test("receipt is generated once for a paid order and enforces buyer, vendor, admin access", async () => {
      const vendor = await createUser("vendor");
      const buyer = await createUser("buyer");
      const otherBuyer = await createUser("buyer");
      const admin = await createUser("admin");
      const courier = await createUser("courier");
      const product = await createProduct(vendor, { priceCents: 1250 });
      await putInCart(buyer, product, 2);
      const created = await checkout(buyer);
      await simulate(buyer, created.body.payment.id);

      const receipt = await Receipt.findOne({ order: created.body.order._id });
      expect(receipt).not.toBeNull();
      expect(receipt.pdfData.subarray(0, 4).toString()).toBe("%PDF");

      const fetchReceipt = (user) =>
        request(app)
          .get(`/api/orders/${created.body.order._id}/receipt`)
          .set("Authorization", `Bearer ${tokenFor(user)}`)
          .buffer(true)
          .parse((response, callback) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => callback(null, Buffer.concat(chunks)));
          });
      for (const allowedUser of [buyer, vendor, admin]) {
        const response = await fetchReceipt(allowedUser);
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toMatch(/application\/pdf/);
        expect(response.body.subarray(0, 4).toString()).toBe("%PDF");
      }
      expect((await fetchReceipt(otherBuyer)).status).toBe(404);
      expect((await fetchReceipt(courier)).status).toBe(403);
      expect(await Receipt.countDocuments({ order: created.body.order._id })).toBe(1);
    });

  test("admin dashboard returns transaction, status, user, delivery, and fee totals", async () => {
      const vendor = await createUser("vendor");
      const buyer = await createUser("buyer");
      const admin = await createUser("admin");
      const courier = await createUser("courier");
      const product = await createProduct(vendor, { priceCents: 2000 });
      await putInCart(buyer, product);
      const created = await checkout(buyer);
      await simulate(buyer, created.body.payment.id);
      await updateOrderStatus(vendor, created.body.order._id, "Shipped");
      await request(app)
        .post(`/api/courier/${created.body.order._id}/accept`)
        .set("Authorization", `Bearer ${tokenFor(courier)}`);

      const response = await request(app)
        .get("/api/admin/dashboard")
        .set("Authorization", `Bearer ${tokenFor(admin)}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        transactionVolumeCents: 2000,
        activeDeliveries: 1,
        totalUsers: 4,
        ordersByStatus: { Shipped: 1 },
        userCounts: { buyer: 1, vendor: 1, courier: 1, admin: 1 },
        platformFeeRevenue: {
          last7DaysCents: 200,
          last30DaysCents: 200
        }
      });

      const forbidden = await request(app)
        .get("/api/admin/dashboard")
        .set("Authorization", `Bearer ${tokenFor(buyer)}`);
      expect(forbidden.status).toBe(403);
    });

  test("admin refund reverses ledger entries, is balanced, and is idempotent", async () => {
      const vendor = await createUser("vendor");
      const buyer = await createUser("buyer");
      const admin = await createUser("admin");
      const product = await createProduct(vendor, { priceCents: 2000 });
      await putInCart(buyer, product);
      const created = await checkout(buyer);
      await simulate(buyer, created.body.payment.id);
      const createdDispute = await request(app)
        .post("/api/disputes")
        .set("Authorization", `Bearer ${tokenFor(buyer)}`)
        .send({
          orderId: created.body.order._id,
          reason: "The meal was not delivered as described."
        });
      expect(createdDispute.status).toBe(201);

      const refund = () =>
        request(app)
          .patch(`/api/disputes/${createdDispute.body.dispute._id}`)
          .set("Authorization", `Bearer ${tokenFor(admin)}`)
          .send({ status: "Refunded" });
      const first = await refund();
      const second = await refund();
      expect(first.status).toBe(200);
      expect(first.body.duplicate).toBe(false);
      expect(second.status).toBe(200);
      expect(second.body.duplicate).toBe(true);
      expect(second.body.dispute.status).toBe("Refunded");
      expect(await Order.findById(created.body.order._id).then((order) => order.status)).toBe("Refunded");
      expect(await Payment.findById(created.body.payment.id).then((payment) => payment.status)).toBe("refunded");

      const entries = await LedgerEntry.find({ order: created.body.order._id });
      const debits = entries.filter((entry) => entry.direction === "debit")
        .reduce((total, entry) => total + entry.amountCents, 0);
      const credits = entries.filter((entry) => entry.direction === "credit")
        .reduce((total, entry) => total + entry.amountCents, 0);
      expect(debits).toBe(credits);
      expect(debits).toBe(4000);
      expect(credits).toBe(4000);
      expect(entries).toHaveLength(6);
    });

  test("failed payments create an admin-visible dispute and non-admins cannot resolve disputes", async () => {
      const vendor = await createUser("vendor");
      const buyer = await createUser("buyer");
      const admin = await createUser("admin");
      const product = await createProduct(vendor);
      await putInCart(buyer, product);
      const created = await checkout(buyer);
      await simulate(buyer, created.body.payment.id, "failed");

      const adminList = await request(app)
        .get("/api/disputes")
        .set("Authorization", `Bearer ${tokenFor(admin)}`);
      expect(adminList.status).toBe(200);
      expect(adminList.body.disputes).toHaveLength(1);
      expect(adminList.body.disputes[0]).toMatchObject({
        origin: "system",
        status: "Open"
      });
      const forbidden = await request(app)
        .patch(`/api/disputes/${adminList.body.disputes[0]._id}`)
        .set("Authorization", `Bearer ${tokenFor(buyer)}`)
        .send({ status: "Resolved" });
      expect(forbidden.status).toBe(403);
  });

  test("enforces lifecycle transitions, role restrictions, and records history", async () => {
      const { vendor, buyer, orderId } = await createPaidOrder();
      const courier = await createUser("courier");
      const otherVendor = await createUser("vendor");

      const buyerCannotShip = await updateOrderStatus(buyer, orderId, "Shipped");
      expect(buyerCannotShip.status).toBe(403);
      expect(buyerCannotShip.body.message).toMatch(/role/i);

      const otherVendorCannotShip = await updateOrderStatus(
        otherVendor,
        orderId,
        "Shipped"
      );
      expect(otherVendorCannotShip.status).toBe(404);

      const shipped = await updateOrderStatus(vendor, orderId, "Shipped");
      expect(shipped.status).toBe(200);
      expect(shipped.body.order.status).toBe("Shipped");

      const courierCannotDeliverUnassigned = await request(app)
        .post(`/api/courier/${orderId}/delivered`)
        .set("Authorization", `Bearer ${tokenFor(courier)}`);
      expect(courierCannotDeliverUnassigned.status).toBe(404);

      const accepted = await request(app)
        .post(`/api/courier/${orderId}/accept`)
        .set("Authorization", `Bearer ${tokenFor(courier)}`);
      expect(accepted.status).toBe(200);
      const delivered = await request(app)
        .post(`/api/courier/${orderId}/delivered`)
        .set("Authorization", `Bearer ${tokenFor(courier)}`);
      expect(delivered.status).toBe(200);
      expect(delivered.body.order.status).toBe("Delivered");
      expect(delivered.body.order.statusHistory.map((entry) => entry.status)).toEqual([
        "Pending",
        "Paid",
        "Shipped",
        "Delivered"
      ]);

      const invalidRepeat = await updateOrderStatus(vendor, orderId, "Shipped");
      expect(invalidRepeat.status).toBe(409);
      expect(invalidRepeat.body.message).toMatch(/cannot change order/i);
  });

  test("buyers can cancel only pending orders and cancellation restores stock", async () => {
      const vendor = await createUser("vendor");
      const buyer = await createUser("buyer");
      const product = await createProduct(vendor, { stock: 4 });
      await putInCart(buyer, product, 2);
      const created = await checkout(buyer);

      const cancelled = await updateOrderStatus(buyer, created.body.order._id, "Cancelled");
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.order.status).toBe("Cancelled");
      expect(cancelled.body.order.statusHistory.at(-1).changedByRole).toBe("buyer");
      expect(await Product.findById(product._id).then((item) => item.stock)).toBe(4);

      const anotherProduct = await createProduct(vendor, {
        name: "Paid test item",
        stock: 4
      });
      await putInCart(buyer, anotherProduct);
      const paid = await checkout(buyer);
      await simulate(buyer, paid.body.payment.id);
      const tooLate = await updateOrderStatus(buyer, paid.body.order._id, "Cancelled");
      expect(tooLate.status).toBe(409);
      expect(tooLate.body.message).toMatch(/cannot change order from Paid to Cancelled/i);
  });

  test("courier assignment is atomic when two couriers accept the same order", async () => {
      const { vendor, orderId } = await createPaidOrder();
      const firstCourier = await createUser("courier");
      const secondCourier = await createUser("courier");
      const shipped = await updateOrderStatus(vendor, orderId, "Shipped");
      expect(shipped.status).toBe(200);

      const accept = (courier) =>
        request(app)
          .post(`/api/courier/${orderId}/accept`)
          .set("Authorization", `Bearer ${tokenFor(courier)}`);
      const attempts = await Promise.all([
        accept(firstCourier),
        accept(secondCourier)
      ]);
      expect(attempts.map((result) => result.status).sort()).toEqual([200, 409]);
      const order = await Order.findById(orderId);
      expect([String(firstCourier._id), String(secondCourier._id)]).toContain(
        String(order.courier)
      );

      const winner = String(order.courier) === String(firstCourier._id)
        ? firstCourier
        : secondCourier;
      const deliveries = await request(app)
        .get("/api/courier/deliveries")
        .set("Authorization", `Bearer ${tokenFor(winner)}`);
      expect(deliveries.status).toBe(200);
      expect(deliveries.body.orders.map((item) => item._id)).toContain(
        String(orderId)
      );
  });

  test("Socket.IO authenticates clients and emits order updates only to involved users", async () => {
      const { vendor, buyer, orderId } = await createPaidOrder();
      const courier = await createUser("courier");
      const unrelatedBuyer = await createUser("buyer");
      const server = createServer();
      const io = initializeRealtime(server);
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const url = `http://127.0.0.1:${address.port}`;
      const clients = [];

      try {
        const [buyerSocket, vendorSocket, courierSocket, unrelatedSocket] =
          await Promise.all([
            connectSocket(url, buyer),
            connectSocket(url, vendor),
            connectSocket(url, courier),
            connectSocket(url, unrelatedBuyer)
          ]);
        clients.push(buyerSocket, vendorSocket, courierSocket, unrelatedSocket);

        const unauthorizedJoin = await new Promise((resolve) => {
          unrelatedSocket.emit("order:join", orderId, resolve);
        });
        expect(unauthorizedJoin.joined).toBe(false);

        for (const socket of [buyerSocket, vendorSocket]) {
          const joined = await new Promise((resolve) => {
            socket.emit("order:join", orderId, resolve);
          });
          expect(joined.joined).toBe(true);
        }

        const unrelatedEvents = [];
        unrelatedSocket.on("order:updated", (update) => unrelatedEvents.push(update));

        const buyerShipped = waitForUpdate(buyerSocket, orderId, "Shipped");
        const vendorShipped = waitForUpdate(vendorSocket, orderId, "Shipped");
        await updateOrderStatus(vendor, orderId, "Shipped");
        await Promise.all([buyerShipped, vendorShipped]);

        const buyerAssigned = waitForUpdate(buyerSocket, orderId, "Shipped");
        const courierAssigned = waitForUpdate(courierSocket, orderId, "Shipped");
        await request(app)
          .post(`/api/courier/${orderId}/accept`)
          .set("Authorization", `Bearer ${tokenFor(courier)}`);
        await Promise.all([buyerAssigned, courierAssigned]);

        const deliveredEvents = [
          waitForUpdate(buyerSocket, orderId, "Delivered"),
          waitForUpdate(vendorSocket, orderId, "Delivered"),
          waitForUpdate(courierSocket, orderId, "Delivered")
        ];
        await request(app)
          .post(`/api/courier/${orderId}/delivered`)
          .set("Authorization", `Bearer ${tokenFor(courier)}`);
        const emitted = await Promise.all(deliveredEvents);
        expect(emitted.every((update) => update.orderId === String(orderId))).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(unrelatedEvents).toHaveLength(0);
      } finally {
        clients.forEach((socket) => socket.disconnect());
        await new Promise((resolve) => io.close(resolve));
        resetRealtime();
      }
  });
});
