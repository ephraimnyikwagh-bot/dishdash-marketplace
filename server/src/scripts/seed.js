import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Payment from "../models/Payment.js";
import Payout from "../models/Payout.js";
import Product from "../models/Product.js";
import Receipt from "../models/Receipt.js";
import Review from "../models/Review.js";
import User from "../models/User.js";
import { connectDatabase } from "../config/database.js";

const demoPassword = "CartedDemo2026!";
const demoUsers = [
  { name: "Demo Buyer", email: "buyer@carted.demo", role: "buyer" },
  { name: "Demo Seller One", email: "vendor@carted.demo", role: "vendor" },
  { name: "Demo Seller Two", email: "seller2@carted.demo", role: "vendor" },
  { name: "Demo Seller Three", email: "seller3@carted.demo", role: "vendor" },
  { name: "Demo Courier", email: "courier@carted.demo", role: "courier" },
  { name: "Demo Admin", email: "admin@carted.demo", role: "admin" }
];
const sellers = ["vendor@carted.demo", "seller2@carted.demo", "seller3@carted.demo"];

const listings = [
  ["Samsung Galaxy A54", "128 GB smartphone in excellent working condition, includes charger.", 18500000, 4, "Phones and Tablets", "Like new", "Lagos", "Ikeja"],
  ["iPhone 12 128GB", "Unlocked iPhone with clear display and strong battery health.", 36500000, 2, "Phones and Tablets", "Used", "Lagos", "Yaba"],
  ["Lenovo Tab M10", "10-inch tablet suitable for reading, streaming and study.", 14200000, 3, "Phones and Tablets", "Like new", "Oyo", "Ibadan"],
  ["Oraimo FreePods 4", "Wireless earbuds with charging case and noise reduction.", 4850000, 8, "Electronics", "New", "FCT", "Abuja"],
  ["LG 43-inch Smart TV", "Full HD smart television with remote and streaming apps.", 27800000, 2, "Electronics", "Like new", "Rivers", "Port Harcourt"],
  ["Logitech Wireless Keyboard", "Compact wireless keyboard, barely used and fully tested.", 2200000, 6, "Electronics", "Used", "Ogun", "Abeokuta"],
  ["Ankara Two-Piece Set", "Tailored Ankara top and trousers, size medium.", 1800000, 5, "Fashion", "New", "Lagos", "Surulere"],
  ["Leather Crossbody Bag", "Handmade brown leather bag with adjustable strap.", 3200000, 3, "Fashion", "Like new", "Edo", "Benin City"],
  ["Nike Running Shoes", "Authentic running trainers, size 42, lightly worn.", 9500000, 2, "Fashion", "Used", "Kano", "Kano"],
  ["Standing Fan 18-inch", "Quiet three-speed fan with adjustable height.", 13500000, 4, "Home and Garden", "New", "Enugu", "Enugu"],
  ["Six-piece Dinner Set", "Durable ceramic plates and bowls for everyday use.", 4200000, 5, "Home and Garden", "New", "Delta", "Asaba"],
  ["Work-from-home Desk", "Sturdy wooden desk with two drawers, 120 cm wide.", 6800000, 1, "Home and Garden", "Used", "Lagos", "Lekki"],
  ["Toyota Corolla 2012", "Well-maintained automatic sedan with current papers.", 875000000, 1, "Vehicles", "Used", "Lagos", "Ajah"],
  ["Honda CG 125 Motorcycle", "Reliable commuter bike with recent service.", 480000000, 1, "Vehicles", "Like new", "Kaduna", "Kaduna"],
  ["Bicycle with Helmet", "Adult hybrid bicycle with included helmet and lock.", 12500000, 2, "Vehicles", "Used", "Oyo", "Ibadan"],
  ["Skincare Starter Set", "Gentle cleanser, moisturiser and sunscreen, sealed.", 3500000, 7, "Beauty and Health", "New", "FCT", "Abuja"],
  ["Digital Blood Pressure Monitor", "Easy-read upper-arm monitor with storage case.", 4600000, 3, "Beauty and Health", "New", "Imo", "Owerri"],
  ["Natural Hair Care Bundle", "Locally made shampoo, conditioner and hair oil.", 2800000, 4, "Beauty and Health", "New", "Abia", "Umuahia"],
  ["Adjustable Dumbbell Pair", "Two adjustable dumbbells with plates and collars.", 11500000, 2, "Sports and Fitness", "Like new", "Ogun", "Ikeja"],
  ["Yoga Mat and Blocks", "Non-slip exercise mat with two foam support blocks.", 2600000, 5, "Sports and Fitness", "New", "Lagos", "Yaba"],
  ["Football Boots Size 44", "Firm-ground boots suitable for training and matches.", 3800000, 2, "Sports and Fitness", "Used", "Plateau", "Jos"],
  ["WAEC Mathematics Revision Guide", "Recent exam-prep guide with worked practice questions.", 950000, 12, "Books and Education", "Like new", "Osun", "Osogbo"],
  ["Oxford Learner's Dictionary", "Paperback English learner's dictionary in good shape.", 1750000, 4, "Books and Education", "Used", "Lagos", "Ikeja"],
  ["Beginner's Laptop Coding Kit", "Raspberry Pi-compatible starter kit with beginner guide.", 8200000, 3, "Books and Education", "New", "FCT", "Abuja"]
].map(([title, description, priceCents, quantity, category, condition, state, city], index) => ({
  title,
  name: title,
  description,
  priceCents,
  stock: quantity,
  quantity,
  category,
  condition,
  location: { state, city },
  seller: sellers[index % sellers.length],
  imageUrl: `https://placehold.co/600x400?text=${encodeURIComponent(title)}`,
  images: [`https://placehold.co/600x400?text=${encodeURIComponent(title)}`]
}));

async function clearDemoData() {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const demoAccountFilter = { email: /@(dishdash|carted)\.demo$/i };
      const existingUsers = await User.find(demoAccountFilter).select("_id").session(session).lean();
      const userIds = existingUsers.map((user) => user._id);
      if (!userIds.length) return;
      const productIds = (await Product.find({ vendor: { $in: userIds } }).select("_id").session(session).lean())
        .map((product) => product._id);
      const orders = await Order.find({
        $or: [{ buyer: { $in: userIds } }, { vendor: { $in: userIds } }, { courier: { $in: userIds } }]
      }).select("_id payment").session(session).lean();
      const orderIds = orders.map((order) => order._id);
      const paymentIds = orders.map((order) => order.payment).filter(Boolean);
      await Cart.deleteMany({ buyer: { $in: userIds } }).session(session);
      await Cart.updateMany({}, { $pull: { items: { product: { $in: productIds } } } }, { session });
      await Product.deleteMany({ vendor: { $in: userIds } }).session(session);
      await OrderItem.deleteMany({ $or: [{ order: { $in: orderIds } }, { vendor: { $in: userIds } }] }).session(session);
      await Payment.deleteMany({ $or: [{ _id: { $in: paymentIds } }, { order: { $in: orderIds } }] }).session(session);
      await Receipt.deleteMany({ order: { $in: orderIds } }).session(session);
      await LedgerEntry.deleteMany({ $or: [{ order: { $in: orderIds } }, { owner: { $in: userIds } }] }).session(session);
      await Dispute.deleteMany({ $or: [{ order: { $in: orderIds } }, { buyer: { $in: userIds } }] }).session(session);
      await Review.deleteMany({ $or: [{ order: { $in: orderIds } }, { buyer: { $in: userIds } }, { seller: { $in: userIds } }] }).session(session);
      await Payout.deleteMany({ seller: { $in: userIds } }).session(session);
      await Order.deleteMany({ _id: { $in: orderIds } }).session(session);
      await User.deleteMany({ _id: { $in: userIds } }).session(session);
    });
  } finally {
    await session.endSession();
  }
}

async function seed() {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
    throw new Error("Refusing to seed demo data in production unless DEMO_MODE=true.");
  }
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required to seed demo data.");
  await connectDatabase();
  await clearDemoData();
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const usersByEmail = new Map();
  for (const user of demoUsers) {
    usersByEmail.set(user.email, await User.create({
      ...user,
      passwordHash,
      isActive: true
    }));
  }
  const sellersByEmail = new Map(sellers.map((email) => [email, usersByEmail.get(email)]));
  const createdProducts = await Product.insertMany(listings.map((listing) => ({
    ...listing,
    vendor: sellersByEmail.get(listing.seller)._id,
    isActive: true
  })));
  const feeBps = Number(process.env.PLATFORM_FEE_BPS || 1000);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new Error("PLATFORM_FEE_BPS must be an integer between 0 and 10000");
  }
  const buyer = usersByEmail.get("buyer@carted.demo");
  const reviewFixtures = [
    { listingIndex: 0, rating: 5, comment: "Exactly as described, and the seller kept me updated.", reply: "Thank you for shopping with me!" },
    { listingIndex: 1, rating: 4, comment: "Good condition and a smooth pickup.", reply: "Glad you are happy with it." },
    { listingIndex: 2, rating: 5, comment: "Carefully packed and delivered on time.", reply: "" }
  ];
  const orderFixtures = [
    ...reviewFixtures.map((review, index) => ({ ...review, state: "released", index })),
    { listingIndex: 3, state: "held", index: 3 },
    { listingIndex: 4, state: "refunded", index: 4 }
  ];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const fixture of orderFixtures) {
        const product = createdProducts[fixture.listingIndex];
        const vendor = product.vendor;
        const totalCents = product.priceCents;
        const platformFeeCents = Number((BigInt(totalCents) * BigInt(feeBps)) / 10000n);
        const released = fixture.state === "released";
        const refunded = fixture.state === "refunded";
        const orderStatus = released ? "Delivered" : refunded ? "Refunded" : "Paid";
        const paidAt = new Date(Date.now() - (fixture.index + 2) * 24 * 60 * 60 * 1000);
        const order = await Order.create([{
          buyer: buyer._id,
          vendor,
          status: orderStatus,
          deliveryMethod: "delivery",
          escrowStatus: released ? "released" : refunded ? "refunded" : "held",
          escrowReleaseAt: released ? paidAt : null,
          buyerConfirmedAt: released ? paidAt : null,
          subtotalCents: totalCents,
          platformFeeCents,
          totalCents,
          currency: "NGN",
          statusHistory: [
            { status: "Paid", changedByRole: "system", changedAt: paidAt },
            ...(released ? [
              { status: "Shipped", changedByRole: "vendor", changedAt: paidAt },
              { status: "Delivered", changedByRole: "courier", changedAt: paidAt }
            ] : refunded ? [
              { status: "Refunded", changedByRole: "admin", changedAt: paidAt }
            ] : [])
          ]
        }], { session });
        const orderDoc = order[0];
        const paymentStatus = refunded ? "refunded" : "succeeded";
        const [payment] = await Payment.create([{
          order: orderDoc._id,
          provider: "mock",
          providerReference: `demo_${orderDoc._id}`,
          providerTransactionId: `demo_tx_${orderDoc._id}`,
          amountCents: totalCents,
          currency: "NGN",
          status: paymentStatus,
          idempotencyKey: `demo_payment_${orderDoc._id}`,
          confirmedAt: paidAt
        }], { session });
        orderDoc.payment = payment._id;
        await orderDoc.save({ session });
        await OrderItem.create([{
          order: orderDoc._id,
          product: product._id,
          vendor,
          name: product.title,
          imageUrl: product.imageUrl,
          quantity: 1,
          unitPriceCents: totalCents,
          lineTotalCents: totalCents
        }], { session });

        const entries = [
          {
            account: "buyer_payment",
            direction: "debit",
            amountCents: totalCents,
            key: "buyer-payment:debit"
          },
          {
            account: "escrow",
            direction: "credit",
            amountCents: totalCents,
            key: "escrow:hold"
          }
        ];
        if (released) {
          entries.push(
            { account: "escrow", direction: "debit", amountCents: totalCents, key: "escrow:release" },
            ...(totalCents > platformFeeCents
              ? [{ account: "seller_payable", direction: "credit", amountCents: totalCents - platformFeeCents, key: "seller-payable:release" }]
              : []),
            ...(platformFeeCents
              ? [{ account: "platform_fee_revenue", direction: "credit", amountCents: platformFeeCents, key: "platform-fee:release" }]
              : [])
          );
        } else if (refunded) {
          entries.push(
            { account: "escrow", direction: "debit", amountCents: totalCents, key: "refund:escrow" },
            { account: "buyer_payment", direction: "credit", amountCents: totalCents, key: "refund:buyer-payment" }
          );
        }
        await LedgerEntry.create(entries.map((entry) => ({
          transactionId: `demo_${orderDoc._id}`,
          order: orderDoc._id,
          owner: vendor,
          account: entry.account,
          direction: entry.direction,
          amountCents: entry.amountCents,
          currency: "NGN",
          idempotencyKey: `${orderDoc._id}:${entry.key}`
        })), { session, ordered: true });

        if (released && fixture.rating) {
          await Review.create([{
            order: orderDoc._id,
            buyer: buyer._id,
            seller: vendor,
            rating: fixture.rating,
            comment: fixture.comment,
            reply: fixture.reply
          }], { session });
        }
      }

      for (const seller of sellersByEmail.values()) {
        const visibleReviews = await Review.find({ seller: seller._id, hidden: false }).session(session);
        seller.ratingCount = visibleReviews.length;
        seller.ratingSum = visibleReviews.reduce((sum, review) => sum + review.rating, 0);
        seller.ratingAverage = seller.ratingCount ? seller.ratingSum / seller.ratingCount : 0;
        await seller.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }
  console.info(`Carted seed complete: ${demoUsers.length} demo users and ${listings.length} marketplace listings across 3 sellers.`);
}

try {
  await seed();
} catch (error) {
  console.error("Carted demo seed failed.", {
    name: error?.name || "Error",
    code: error?.code || "UNKNOWN"
  });
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
