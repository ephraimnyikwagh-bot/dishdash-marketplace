import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import WebhookEvent from "../models/WebhookEvent.js";
import { createPaymentProvider } from "./payments/index.js";

export class CheckoutError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getPlatformFeeBps() {
  const fee = Number(process.env.PLATFORM_FEE_BPS ?? 1000);
  if (!Number.isInteger(fee) || fee < 0 || fee > 10000) {
    throw new Error("PLATFORM_FEE_BPS must be an integer between 0 and 10000");
  }
  return fee;
}

function checkoutKey(buyerId, key) {
  return `${buyerId}:${key}`;
}

function checkoutResponse(order, payment, reused) {
  return {
    order,
    payment,
    reused
  };
}

export async function createCheckout({
  buyerId,
  clientIdempotencyKey,
  provider = createPaymentProvider(),
  connection = mongoose.connection
}) {
  const idempotencyKey = checkoutKey(buyerId, clientIdempotencyKey);
  const existing = await Order.findOne({ idempotencyKey }).populate("payment");
  if (existing) return checkoutResponse(existing, existing.payment, true);

  const [cart, buyer] = await Promise.all([
    Cart.findOne({ buyer: buyerId }).populate("items.product"),
    User.findById(buyerId).select("name email")
  ]);
  if (!cart?.items.length) throw new CheckoutError(400, "Your cart is empty");
  if (!buyer) throw new CheckoutError(404, "Buyer account was not found");

  const items = cart.items.map((item) => {
    const product = item.product;
    if (!product || !product.isActive) {
      throw new CheckoutError(
        409,
        "A product in your cart is no longer available"
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutError(400, "Your cart contains an invalid quantity");
    }
    if (!Number.isInteger(product.priceCents) || product.priceCents < 1) {
      throw new CheckoutError(
        409,
        "A product in your cart has an invalid price"
      );
    }
    return { product, quantity: item.quantity };
  });

  const vendorId = String(items[0].product.vendor);
  if (items.some(({ product }) => String(product.vendor) !== vendorId)) {
    throw new CheckoutError(
      400,
      "Checkout currently supports items from one vendor at a time"
    );
  }

  const subtotalCents = items.reduce(
    (sum, { product, quantity }) => sum + product.priceCents * quantity,
    0
  );
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 1) {
    throw new CheckoutError(400, "Cart total is invalid");
  }

  const platformFeeCents = Number(
    (BigInt(subtotalCents) * BigInt(getPlatformFeeBps())) / 10000n
  );
  const orderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const session = await connection.startSession();
  let result;

  try {
    await session.withTransaction(
      async () => {
        for (const { product, quantity } of items) {
          const reserved = await Product.findOneAndUpdate(
            {
              _id: product._id,
              vendor: product.vendor,
              isActive: true,
              priceCents: product.priceCents,
              stock: { $gte: quantity }
            },
            { $inc: { stock: -quantity } },
            { new: true, session }
          );
          if (!reserved) {
            throw new CheckoutError(
              409,
              `${product.name} no longer has enough stock`
            );
          }
        }

        const [order] = await Order.create(
          [
            {
              _id: orderId,
              buyer: buyerId,
              vendor: vendorId,
              status: "Pending",
              subtotalCents,
              platformFeeCents,
              totalCents: subtotalCents,
              currency: "USD",
              idempotencyKey
            }
          ],
          { session }
        );

        await OrderItem.create(
          items.map(({ product, quantity }) => ({
            order: order._id,
            product: product._id,
            vendor: product.vendor,
            name: product.name,
            quantity,
            unitPriceCents: product.priceCents,
            lineTotalCents: product.priceCents * quantity
          })),
          { session, ordered: true }
        );

        const intent = await provider.createIntent({
          amountCents: subtotalCents,
          currency: "USD",
          idempotencyKey,
          email: buyer.email,
          name: buyer.name,
          orderId: String(order._id)
        });
        if (!intent?.id) throw new Error("Payment provider returned no reference");

        const [payment] = await Payment.create(
          [
            {
              _id: paymentId,
              order: order._id,
              provider: provider.name,
              providerReference: intent.id,
              paymentUrl: intent.paymentUrl || null,
              amountCents: subtotalCents,
              currency: "USD",
              status: "pending",
              idempotencyKey
            }
          ],
          { session }
        );
        order.payment = payment._id;
        await order.save({ session });

        const cleared = await Cart.updateOne(
          { _id: cart._id, buyer: buyerId, __v: cart.__v },
          { $set: { items: [] }, $inc: { __v: 1 } },
          { session }
        );
        if (cleared.modifiedCount !== 1) {
          throw new CheckoutError(
            409,
            "Your cart changed during checkout. Please try again."
          );
        }

        result = checkoutResponse(order, payment, false);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" }
      }
    );
  } catch (error) {
    if (error.code === 11000) {
      const concurrent = await Order.findOne({ idempotencyKey }).populate(
        "payment"
      );
      if (concurrent) {
        return checkoutResponse(concurrent, concurrent.payment, true);
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return result;
}

export async function processPaymentEvent({
  providerName,
  eventId,
  reference,
  outcome,
  connection = mongoose.connection
}) {
  if (!["succeeded", "failed", "expired"].includes(outcome)) {
    throw new CheckoutError(400, "Payment outcome is invalid");
  }
  if (!eventId || !reference) {
    throw new CheckoutError(400, "Payment event ID and reference are required");
  }

  const session = await connection.startSession();
  let duplicate = false;

  try {
    await session.withTransaction(
      async () => {
        const prior = await WebhookEvent.findOne({ eventId }).session(session);
        if (prior) {
          duplicate = true;
          return;
        }

        const payment = await Payment.findOne({
          provider: providerName,
          providerReference: reference
        }).session(session);
        if (!payment) {
          throw new CheckoutError(404, "Payment was not found");
        }
        const order = await Order.findById(payment.order).session(session);
        if (!order) throw new Error("Payment references a missing order");

        await WebhookEvent.create(
          [{ eventId, provider: providerName, type: outcome }],
          { session }
        );

        if (payment.status !== "pending" || order.status !== "Pending") return;

        if (outcome === "succeeded") {
          payment.status = "succeeded";
          payment.confirmedAt = new Date();
          order.status = "Paid";
          await payment.save({ session });
          await order.save({ session });

          const vendorPayableCents =
            order.totalCents - order.platformFeeCents;
          const entries = [
            {
              transactionId: String(payment._id),
              order: order._id,
              account: "buyer_clearing",
              direction: "debit",
              amountCents: order.totalCents,
              currency: order.currency,
              idempotencyKey: `${providerName}:${reference}:buyer-debit`
            }
          ];
          if (vendorPayableCents > 0) {
            entries.push({
              transactionId: String(payment._id),
              order: order._id,
              account: "vendor_payable",
              direction: "credit",
              amountCents: vendorPayableCents,
              currency: order.currency,
              idempotencyKey: `${providerName}:${reference}:vendor-credit`
            });
          }
          if (order.platformFeeCents > 0) {
            entries.push({
              transactionId: String(payment._id),
              order: order._id,
              account: "platform_revenue",
              direction: "credit",
              amountCents: order.platformFeeCents,
              currency: order.currency,
              idempotencyKey: `${providerName}:${reference}:platform-credit`
            });
          }
          await LedgerEntry.create(entries, { session, ordered: true });
          return;
        }

        payment.status = "failed";
        order.status = "Failed";
        await payment.save({ session });
        await order.save({ session });
        const orderItems = await OrderItem.find({ order: order._id }).session(
          session
        );
        for (const item of orderItems) {
          const restored = await Product.updateOne(
            { _id: item.product },
            { $inc: { stock: item.quantity } },
            { session }
          );
          if (restored.matchedCount !== 1) {
            throw new Error(`Could not restore stock for product ${item.product}`);
          }
        }
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" }
      }
    );
  } catch (error) {
    if (error.code === 11000) {
      duplicate = true;
    } else {
      throw error;
    }
  } finally {
    await session.endSession();
  }

  return { duplicate, ignored: false };
}
