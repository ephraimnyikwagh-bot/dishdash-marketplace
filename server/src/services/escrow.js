import mongoose from "mongoose";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import { emitOrderUpdated } from "./realtime.js";

export function getEscrowAutoReleaseDays() {
  const days = Number(process.env.ESCROW_AUTO_RELEASE_DAYS ?? 3);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("ESCROW_AUTO_RELEASE_DAYS must be an integer between 1 and 365");
  }
  return days;
}

export async function getEscrowBalanceCents(session, currency = "NGN") {
  const [balance] = await LedgerEntry.aggregate([
    { $match: { account: "escrow", currency } },
    {
      $group: {
        _id: null,
        balanceCents: {
          $sum: {
            $cond: [
              { $eq: ["$direction", "credit"] },
              "$amountCents",
              { $multiply: ["$amountCents", -1] }
            ]
          }
        }
      }
    }
  ]).session(session);
  return balance?.balanceCents || 0;
}

export async function releaseEscrowInSession(order, session, { now = new Date(), immediate = false } = {}) {
  if (
    order.status !== "Delivered" ||
    order.escrowStatus !== "held" ||
    (!immediate && (!order.escrowReleaseAt || order.escrowReleaseAt > now))
  ) {
    return false;
  }

  const dispute = await Dispute.findOne({
    order: order._id,
    status: { $in: ["Open", "Under review"] }
  }).session(session);
  if (dispute) return false;

  const hold = await LedgerEntry.findOne({
    order: order._id,
    account: "escrow",
    direction: "credit",
    idempotencyKey: `${order._id}:escrow:hold`
  }).session(session);
  if (!hold || hold.amountCents !== order.totalCents) {
    throw new Error(`Escrow hold is missing or invalid for order ${order._id}`);
  }
  const alreadyReleased = await LedgerEntry.exists({
    order: order._id,
    idempotencyKey: `${order._id}:escrow:release`
  }).session(session);
  if (alreadyReleased) {
    order.escrowStatus = "released";
    await order.save({ session });
    return false;
  }
  const escrowBalance = await getEscrowBalanceCents(session, order.currency);
  if (escrowBalance < order.totalCents) {
    throw new Error(`Escrow balance would go negative while releasing order ${order._id}`);
  }

  const feeCents = order.platformFeeCents;
  const sellerCents = order.subtotalCents - feeCents;
  if (!Number.isSafeInteger(sellerCents) || sellerCents < 0) {
    throw new Error(`Invalid seller payable amount for order ${order._id}`);
  }
  const entries = [
    {
      transactionId: `release_${order._id}`,
      order: order._id,
      owner: order.vendor,
      account: "escrow",
      direction: "debit",
      amountCents: order.totalCents,
      currency: order.currency,
      idempotencyKey: `${order._id}:escrow:release`
    }
  ];
  if (sellerCents) {
    entries.push({
      transactionId: `release_${order._id}`,
      order: order._id,
      owner: order.vendor,
      account: "seller_payable",
      direction: "credit",
      amountCents: sellerCents,
      currency: order.currency,
      idempotencyKey: `${order._id}:seller-payable:release`
    });
  }
  if (feeCents) {
    entries.push({
      transactionId: `release_${order._id}`,
      order: order._id,
      owner: order.vendor,
      account: "platform_fee_revenue",
      direction: "credit",
      amountCents: feeCents,
      currency: order.currency,
      idempotencyKey: `${order._id}:platform-fee:release`
    });
  }
  await LedgerEntry.create(entries, { session, ordered: true });
  order.escrowStatus = "released";
  await order.save({ session });
  return true;
}

export async function releaseMatureEscrows({ sellerId, buyerId, connection = mongoose.connection, now = new Date() } = {}) {
  const filter = {
    status: "Delivered",
    deliveryMethod: "delivery",
    escrowStatus: "held",
    escrowReleaseAt: { $lte: now }
  };
  if (sellerId) filter.vendor = sellerId;
  if (buyerId) filter.buyer = buyerId;
  const orders = await Order.find(filter).select("_id").sort({ escrowReleaseAt: 1 }).limit(500).lean();
  let released = 0;

  for (const { _id } of orders) {
    const session = await connection.startSession();
    let updated;
    try {
      await session.withTransaction(async () => {
        const order = await Order.findById(_id).session(session);
        if (!order) return;
        const changed = await releaseEscrowInSession(order, session, { now });
        if (changed) updated = order.toObject();
      });
    } finally {
      await session.endSession();
    }
    if (updated) {
      released += 1;
      emitOrderUpdated(updated);
    }
  }
  return released;
}

export function startEscrowAutoReleaseTimer({ intervalMs = 60_000 } = {}) {
  const timer = setInterval(() => {
    releaseMatureEscrows().catch((error) => {
      console.error("Escrow auto-release check failed.", {
        name: error?.name || "Error",
        code: error?.code || "UNKNOWN"
      });
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}
