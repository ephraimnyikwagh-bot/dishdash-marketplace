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
import Payout from "../models/Payout.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";
import User from "../models/User.js";

const jwtSecret = "commerce-test-secret-at-least-thirty-two-characters";

describe("escrow, payouts, and seller reviews", () => {
  let replicaSet;

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.PLATFORM_FEE_BPS = "1000";
    process.env.ESCROW_AUTO_RELEASE_DAYS = "3";
    process.env.NODE_ENV = "test";
    process.env.PAYMENT_PROVIDER = "mock";
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      instanceOpts: [{ launchTimeout: 60000 }]
    });
    await mongoose.connect(replicaSet.getUri("commerce_test"));
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replicaSet) await replicaSet.stop();
  }, 120000);

  beforeEach(async () => {
    await Promise.all([
      Cart.deleteMany({}),
      Dispute.deleteMany({}),
      LedgerEntry.deleteMany({}),
      Order.deleteMany({}),
      OrderItem.deleteMany({}),
      Payment.deleteMany({}),
      Payout.deleteMany({}),
      Product.deleteMany({}),
      Review.deleteMany({}),
      User.deleteMany({})
    ]);
  });

  async function createUser(role = "buyer") {
    return User.create({
      name: `${role} ${new mongoose.Types.ObjectId().toString().slice(-5)}`,
      email: `${role}-${new mongoose.Types.ObjectId()}@example.test`,
      passwordHash: "test-hash",
      role
    });
  }

  function auth(user) {
    const token = jwt.sign({ role: user.role }, jwtSecret, {
      subject: String(user._id),
      issuer: "carted-api",
      audience: "carted"
    });
    return { Authorization: `Bearer ${token}` };
  }

  async function createPaidOrder({ vendor, buyer, deliveryMethod = "delivery" } = {}) {
    const seller = vendor || await createUser("vendor");
    const purchaser = buyer || await createUser("buyer");
    const product = await Product.create({
      vendor: seller._id,
      name: "Marketplace test item",
      title: "Marketplace test item",
      category: "Electronics",
      priceCents: 10000,
      stock: 4,
      quantity: 4,
      isActive: true
    });
    await Cart.findOneAndUpdate(
      { buyer: purchaser._id },
      { $set: { items: [{ product: product._id, quantity: 1 }] } },
      { upsert: true, new: true }
    );
    const checkout = await request(app)
      .post("/api/checkout")
      .set(auth(purchaser))
      .set("Idempotency-Key", `commerce-${new mongoose.Types.ObjectId()}`)
      .send({ deliveryMethod });
    expect(checkout.status).toBe(201);

    const payment = await request(app)
      .post(`/api/payments/${checkout.body.payment.id}/simulate`)
      .set(auth(purchaser))
      .send({ outcome: "succeeded" });
    expect(payment.status).toBe(200);
    return {
      vendor: seller,
      buyer: purchaser,
      product,
      orderId: checkout.body.order._id,
      paymentId: checkout.body.payment.id
    };
  }

  async function deliver(order) {
    const shipped = await request(app)
      .patch(`/api/orders/${order.orderId}/status`)
      .set(auth(order.vendor))
      .send({ status: "Shipped" });
    expect(shipped.status).toBe(200);
    const courier = await createUser("courier");
    const accepted = await request(app)
      .post(`/api/courier/${order.orderId}/accept`)
      .set(auth(courier));
    expect(accepted.status).toBe(200);
    const delivered = await request(app)
      .patch(`/api/orders/${order.orderId}/status`)
      .set(auth(courier))
      .send({ status: "Delivered" });
    expect(delivered.status).toBe(200);
    return courier;
  }

  async function disputeFor(order, buyer = order.buyer) {
    const response = await request(app)
      .post("/api/disputes")
      .set(auth(buyer))
      .send({ orderId: order.orderId, reason: "Please review this transaction." });
    expect(response.status).toBe(201);
    return response.body.dispute;
  }

  async function assertLedgerBalanced() {
    const entries = await LedgerEntry.find({}).lean();
    const debits = entries.filter((entry) => entry.direction === "debit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const credits = entries.filter((entry) => entry.direction === "credit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(debits).toBe(credits);
    const integrity = await request(app)
      .get("/api/ledger/integrity")
      .set(auth(await createUser("admin")));
    expect(integrity.status).toBe(200);
    expect(integrity.body.balanced).toBe(true);
    expect(integrity.body.escrow.nonNegative).toBe(true);
  }

  test("successful payment holds funds in escrow and never credits seller early", async () => {
    const order = await createPaidOrder();
    const entries = await LedgerEntry.find({ order: order.orderId }).lean();
    expect(entries.map(({ account, direction }) => [account, direction])).toEqual([
      ["buyer_payment", "debit"],
      ["escrow", "credit"]
    ]);
    expect(await LedgerEntry.countDocuments({ order: order.orderId, account: "seller_payable" })).toBe(0);
    expect(await Order.findById(order.orderId).then((record) => record.escrowStatus)).toBe("held");
    await assertLedgerBalanced();
  });

  test("delivery confirmation releases escrow once and seller payout posting is balanced", async () => {
    const order = await createPaidOrder();
    await deliver(order);
    const delivered = await Order.findById(order.orderId);
    expect(delivered.escrowStatus).toBe("held");
    expect(delivered.escrowReleaseAt.getTime()).toBeGreaterThan(Date.now());

    const confirm = () => request(app)
      .post(`/api/orders/${order.orderId}/confirm-received`)
      .set(auth(order.buyer));
    expect((await confirm()).body.order.escrowStatus).toBe("released");
    expect((await confirm()).status).toBe(200);
    expect(await LedgerEntry.countDocuments({ order: order.orderId })).toBe(5);

    const payoutRequest = await request(app)
      .post("/api/ledger/wallet/payouts")
      .set(auth(order.vendor))
      .send({ amountCents: 5000, idempotencyKey: "payout-request-key-1" });
    expect(payoutRequest.status).toBe(201);
    const wallet = await request(app).get("/api/ledger/wallet").set(auth(order.vendor));
    expect(wallet.body).toMatchObject({
      pendingCents: 0,
      availableCents: 4000,
      reservedPayoutCents: 5000
    });
    const admin = await createUser("admin");
    const payoutId = payoutRequest.body.payout._id;
    const markPaid = () => request(app)
      .patch(`/api/ledger/admin/payouts/${payoutId}`)
      .set(auth(admin))
      .send({ status: "Paid out" });
    expect((await markPaid()).body.duplicate).toBe(false);
    expect((await markPaid()).body.duplicate).toBe(true);
    expect(await Payout.findById(payoutId).then((payout) => payout.status)).toBe("Paid out");
    await assertLedgerBalanced();
  });

  test("lazy auto-release waits through open disputes then releases mature funds", async () => {
    const order = await createPaidOrder();
    await deliver(order);
    await disputeFor(order);
    await Order.updateOne({ _id: order.orderId }, { $set: { escrowReleaseAt: new Date(Date.now() - 1000) } });

    const heldRead = await request(app).get("/api/orders").set(auth(order.buyer));
    expect(heldRead.status).toBe(200);
    expect(heldRead.body.orders[0].escrowStatus).toBe("held");
    expect(await LedgerEntry.countDocuments({ order: order.orderId, idempotencyKey: `${order.orderId}:escrow:release` })).toBe(0);

    const admin = await createUser("admin");
    const dispute = await Dispute.findOne({ order: order.orderId });
    const resolved = await request(app)
      .patch(`/api/disputes/${dispute._id}`)
      .set(auth(admin))
      .send({ status: "Resolved" });
    expect(resolved.status).toBe(200);
    const releasedRead = await request(app).get("/api/orders").set(auth(order.buyer));
    expect(releasedRead.body.orders[0].escrowStatus).toBe("released");
    expect(await LedgerEntry.countDocuments({ order: order.orderId, idempotencyKey: `${order.orderId}:escrow:release` })).toBe(1);
    await assertLedgerBalanced();
  });

  test("refund before release returns escrow to the buyer, and refund after release reverses payable", async () => {
    const before = await createPaidOrder();
    const beforeDispute = await disputeFor(before);
    const admin = await createUser("admin");
    const beforeRefund = await request(app)
      .patch(`/api/disputes/${beforeDispute._id}`)
      .set(auth(admin))
      .send({ status: "Refunded" });
    expect(beforeRefund.status).toBe(200);
    expect(await Order.findById(before.orderId).then((record) => record.escrowStatus)).toBe("refunded");

    const after = await createPaidOrder();
    await deliver(after);
    const confirmation = await request(app)
      .post(`/api/orders/${after.orderId}/confirm-received`)
      .set(auth(after.buyer));
    expect(confirmation.status).toBe(200);
    const afterDispute = await disputeFor(after);
    const afterRefund = await request(app)
      .patch(`/api/disputes/${afterDispute._id}`)
      .set(auth(admin))
      .send({ status: "Refunded" });
    expect(afterRefund.status).toBe(200);
    expect(await LedgerEntry.countDocuments({ order: after.orderId, account: "seller_payable", direction: "debit" })).toBe(1);
    expect(await LedgerEntry.countDocuments({ order: after.orderId, account: "platform_fee_revenue", direction: "debit" })).toBe(1);
    await assertLedgerBalanced();
  });

  test("reviews require a completed purchase, are unique, and update ratings through replies and moderation", async () => {
    const vendor = await createUser("vendor");
    const buyer = await createUser("buyer");
    const order = await createPaidOrder({ vendor, buyer, deliveryMethod: "pickup" });
    const review = (rating, comment) => request(app)
      .post("/api/reviews")
      .set(auth(buyer))
      .send({ orderId: order.orderId, rating, comment });

    expect((await review(5, "Great item")).status).toBe(409);
    const ready = await request(app)
      .patch(`/api/orders/${order.orderId}/status`)
      .set(auth(vendor))
      .send({ status: "Ready for pickup" });
    expect(ready.status).toBe(200);
    const completed = await request(app)
      .patch(`/api/orders/${order.orderId}/status`)
      .set(auth(buyer))
      .send({ status: "Delivered" });
    expect(completed.body.order.escrowStatus).toBe("released");

    const created = await review(5, "Great item, just as advertised.");
    expect(created.status).toBe(201);
    expect(created.body.verifiedPurchase).toBe(true);
    expect((await review(4, "Duplicate review")).status).toBe(409);
    let seller = await User.findById(vendor._id);
    expect(seller).toMatchObject({ ratingCount: 1, ratingSum: 5, ratingAverage: 5 });

    const secondBuyer = await createUser("buyer");
    const secondOrder = await createPaidOrder({ vendor, buyer: secondBuyer, deliveryMethod: "pickup" });
    await request(app)
      .patch(`/api/orders/${secondOrder.orderId}/status`)
      .set(auth(vendor))
      .send({ status: "Ready for pickup" });
    await request(app)
      .patch(`/api/orders/${secondOrder.orderId}/status`)
      .set(auth(secondBuyer))
      .send({ status: "Delivered" });
    const secondReview = await request(app)
      .post("/api/reviews")
      .set(auth(secondBuyer))
      .send({ orderId: secondOrder.orderId, rating: 3, comment: "A fair experience." });
    expect(secondReview.status).toBe(201);
    seller = await User.findById(vendor._id);
    expect(seller).toMatchObject({ ratingCount: 2, ratingSum: 8, ratingAverage: 4 });

    const reply = await request(app)
      .patch(`/api/reviews/${created.body.review._id}/reply`)
      .set(auth(vendor))
      .send({ reply: "Thank you for the feedback." });
    expect(reply.status).toBe(200);
    expect((await request(app)
      .patch(`/api/reviews/${created.body.review._id}/reply`)
      .set(auth(vendor))
      .send({ reply: "Another reply" })).status).toBe(409);

    const reporter = await createUser("buyer");
    expect((await request(app)
      .post(`/api/reviews/${created.body.review._id}/report`)
      .set(auth(reporter))
      .send({ reason: "Please check this review." })).status).toBe(201);

    const profile = await request(app).get(`/api/public/sellers/${vendor._id}`);
    expect(profile.body.reviews.items).toHaveLength(2);
    expect(profile.body.reviews.items.find((item) => item._id === created.body.review._id)).toMatchObject({
      rating: 5,
      verifiedPurchase: true,
      reply: "Thank you for the feedback."
    });

    const admin = await createUser("admin");
    const hidden = await request(app)
      .patch(`/api/reviews/${created.body.review._id}/moderation`)
      .set(auth(admin))
      .send({ hidden: true });
    expect(hidden.status).toBe(200);
    seller = await User.findById(vendor._id);
    expect(seller).toMatchObject({ ratingCount: 1, ratingSum: 3, ratingAverage: 3 });
    const publicReviews = await request(app).get(`/api/reviews/seller/${vendor._id}`);
    expect(publicReviews.body.reviews).toHaveLength(1);
    expect(publicReviews.body.reviews[0].rating).toBe(3);
    await assertLedgerBalanced();
  });
});
