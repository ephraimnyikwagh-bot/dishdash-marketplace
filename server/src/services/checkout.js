import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Payment from "../models/Payment.js";
import Product from "../models/Product.js";
import WebhookEvent from "../models/WebhookEvent.js";

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

function createCheckoutKey(buyerId, clientKey) {
  return `${buyerId}:${clientKey}`;
}

async function createOrRetrieveIntent({ order, payment, gateway }) {
  const intent = payment.providerIntentId
    ? await gateway.retrievePaymentIntent(payment.providerIntentId)
    : await gateway.createPaymentIntent({
        amountCents: payment.amountCents,
        currency: payment.currency.toLowerCase(),
        idempotencyKey: `dishdash:${payment.idempotencyKey}`,
        metadata: {
          orderId: String(order._id),
          buyerId: String(order.buyer)
        }
      });

  if (!intent?.id || !intent.client_secret) {
    throw new Error("Stripe did not return a PaymentIntent client secret");
  }

  if (!payment.providerIntentId) {
    const paymentId = payment._id;
    payment =
      (await Payment.findOneAndUpdate(
        { _id: paymentId, providerIntentId: { $exists: false } },
        { $set: { providerIntentId: intent.id } },
        { new: true }
      )) || (await Payment.findById(paymentId));
    if (!payment) {
      throw new Error(
        "Payment record disappeared while attaching Stripe intent"
      );
    }
  }

  return { order, payment, clientSecret: intent.client_secret };
}

async function getExistingCheckout({ key, gateway }) {
  const existing = await Order.findOne({ idempotencyKey: key }).populate(
    "payment"
  );
  if (!existing) return null;

  if (!existing.payment) {
    throw new Error("Existing checkout is missing its payment record");
  }

  return createOrRetrieveIntent({
    order: existing,
    payment: existing.payment,
    gateway
  });
}

export async function createCheckout({
  buyerId,
  clientIdempotencyKey,
  gateway,
  connection = mongoose.connection
}) {
  const idempotencyKey = createCheckoutKey(buyerId, clientIdempotencyKey);
  const existing = await getExistingCheckout({ key: idempotencyKey, gateway });
  if (existing) return { ...existing, reused: true };

  const cart = await Cart.findOne({ buyer: buyerId }).populate("items.product");
  if (!cart?.items.length) {
    throw new CheckoutError(400, "Your cart is empty");
  }

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
    (total, { product, quantity }) => total + product.priceCents * quantity,
    0
  );
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 1) {
    throw new CheckoutError(400, "Cart total is invalid");
  }

  const platformFeeCents = Number(
    (BigInt(subtotalCents) * BigInt(getPlatformFeeBps())) / 10000n
  );
  const totalCents = subtotalCents;
  const orderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  let session;
  let checkout;
  try {
    session = await connection.startSession();
    await session.withTransaction(
      async () => {
        for (const { product, quantity } of items) {
          const reserved = await Product.updateOne(
            {
              _id: product._id,
              isActive: true,
              vendor: product.vendor,
              priceCents: product.priceCents,
              stock: { $gte: quantity }
            },
            { $inc: { stock: -quantity } },
            { session }
          );
          if (reserved.modifiedCount !== 1) {
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
              totalCents,
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

        const [payment] = await Payment.create(
          [
            {
              _id: paymentId,
              order: order._id,
              provider: "stripe",
              amountCents: totalCents,
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

        checkout = { order, payment };
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" }
      }
    );
  } catch (error) {
    try {
      const concurrent = await getExistingCheckout({
        key: idempotencyKey,
        gateway
      });
      if (concurrent) return { ...concurrent, reused: true };
    } catch (lookupError) {
      if (error.code === 11000) throw lookupError;
    }
    throw error;
  } finally {
    if (session) await session.endSession();
  }

  const withIntent = await createOrRetrieveIntent({
    ...checkout,
    gateway
  });
  return { ...withIntent, reused: false };
}

export async function processStripeEvent({
  event,
  connection = mongoose.connection
}) {
  if (
    event.type !== "payment_intent.succeeded" &&
    event.type !== "payment_intent.payment_failed" &&
    event.type !== "payment_intent.canceled"
  ) {
    return { ignored: true };
  }

  const intent = event.data?.object;
  if (!intent?.id)
    throw new CheckoutError(400, "Webhook has no payment intent");

  const session = await connection.startSession();
  let duplicate = false;
  try {
    await session.withTransaction(
      async () => {
        const alreadyProcessed = await WebhookEvent.exists({
          eventId: event.id
        }).session(session);
        if (alreadyProcessed) {
          duplicate = true;
          return;
        }

        const payment = await Payment.findOne({
          provider: "stripe",
          providerIntentId: intent.id
        }).session(session);
        if (!payment) {
          throw new CheckoutError(
            404,
            "Payment for this webhook was not found"
          );
        }

        const order = await Order.findById(payment.order).session(session);
        if (!order) throw new Error("Payment references a missing order");

        await WebhookEvent.create(
          [{ eventId: event.id, provider: "stripe", type: event.type }],
          { session }
        );

        if (event.type === "payment_intent.succeeded") {
          if (payment.status === "pending" && order.status === "Pending") {
            if (intent.amount_received !== payment.amountCents) {
              throw new CheckoutError(
                400,
                "Stripe payment amount does not match the order"
              );
            }

            payment.status = "succeeded";
            payment.confirmedAt = new Date();
            await payment.save({ session });
            order.status = "Paid";
            await order.save({ session });

            const vendorPayableCents =
              order.totalCents - order.platformFeeCents;
            const entries = [
              {
                transactionId: intent.id,
                order: order._id,
                account: "buyer_clearing",
                direction: "debit",
                amountCents: order.totalCents,
                currency: order.currency,
                idempotencyKey: `stripe:${intent.id}:buyer-debit`
              }
            ];

            if (vendorPayableCents > 0) {
              entries.push({
                transactionId: intent.id,
                order: order._id,
                account: "vendor_payable",
                direction: "credit",
                amountCents: vendorPayableCents,
                currency: order.currency,
                idempotencyKey: `stripe:${intent.id}:vendor-credit`
              });
            }
            if (order.platformFeeCents > 0) {
              entries.push({
                transactionId: intent.id,
                order: order._id,
                account: "platform_revenue",
                direction: "credit",
                amountCents: order.platformFeeCents,
                currency: order.currency,
                idempotencyKey: `stripe:${intent.id}:platform-credit`
              });
            }
            await LedgerEntry.create(entries, { session, ordered: true });
          }
        } else if (
          event.type === "payment_intent.canceled" &&
          payment.status === "pending" &&
          order.status === "Pending"
        ) {
          payment.status = "failed";
          await payment.save({ session });
          order.status = "Failed";
          await order.save({ session });

          const orderItems = await OrderItem.find({ order: order._id }).session(
            session
          );
          for (const item of orderItems) {
            await Product.updateOne(
              { _id: item.product },
              { $inc: { stock: item.quantity } },
              { session }
            );
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

  return { ignored: false, duplicate };
}
