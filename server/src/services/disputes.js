import mongoose from "mongoose";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import { createPaymentProvider } from "./payments/index.js";
import { emitOrderUpdated } from "./realtime.js";

export class DisputeError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function createBuyerDispute({ buyerId, orderId, reason }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new DisputeError(400, "Invalid order ID");
  }
  const order = await Order.findOne({ _id: orderId, buyer: buyerId });
  if (!order) throw new DisputeError(404, "Order not found");
  if (!["Paid", "Delivered"].includes(order.status)) {
    throw new DisputeError(
      409,
      "A dispute can only be raised for a Paid or Delivered order"
    );
  }
  try {
    return await Dispute.create({
      order: order._id,
      buyer: buyerId,
      reason: reason.trim(),
      origin: "buyer",
      status: "Open"
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new DisputeError(409, "A dispute already exists for this order");
    }
    throw error;
  }
}

export async function resolveDispute({
  disputeId,
  action,
  adminId,
  providerFactory = createPaymentProvider,
  connection = mongoose.connection
}) {
  if (!mongoose.isValidObjectId(disputeId)) {
    throw new DisputeError(400, "Invalid dispute ID");
  }
  if (!["Under review", "Resolved", "Refunded"].includes(action)) {
    throw new DisputeError(
      400,
      "Action must be Under review, Resolved, or Refunded"
    );
  }
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new DisputeError(404, "Dispute not found");
  if (dispute.status === "Refunded") {
    return { dispute, duplicate: true };
  }

  let payment;
  let order;
  let providerRefund;
  if (action === "Refunded") {
    order = await Order.findById(dispute.order);
    if (!order) throw new Error("Dispute references a missing order");
    payment = await Payment.findOne({ order: order._id });
    if (!payment || payment.status !== "succeeded") {
      throw new DisputeError(409, "Only a successfully paid order can be refunded");
    }
    const refundReference =
      payment.provider === "flutterwave"
        ? payment.providerTransactionId
        : payment.providerReference;
    providerRefund = await providerFactory(payment.provider).refund({
      reference: refundReference,
      transactionId: refundReference,
      amountCents: payment.amountCents,
      idempotencyKey: `refund:${payment._id}`
    });
  }

  const session = await connection.startSession();
  let updatedDispute;
  let updatedOrder;
  let duplicate = false;
  try {
    await session.withTransaction(async () => {
      const current = await Dispute.findById(disputeId).session(session);
      if (!current) throw new DisputeError(404, "Dispute not found");
      if (current.status === "Refunded") {
        updatedDispute = current;
        duplicate = true;
        return;
      }

      if (action === "Refunded") {
        const orderRecord = await Order.findOne({
          _id: current.order,
          status: { $in: ["Paid", "Shipped", "Delivered"] }
        }).session(session);
        const paymentRecord = await Payment.findOne({
          order: current.order,
          status: "succeeded"
        }).session(session);
        if (!orderRecord || !paymentRecord) {
          throw new DisputeError(
            409,
            "The order or payment has already changed and cannot be refunded"
          );
        }

        const originalEntries = await LedgerEntry.find({
          order: current.order,
          idempotencyKey: { $not: /:refund:/ }
        }).session(session);
        if (!originalEntries.length) {
          throw new DisputeError(409, "No original ledger entries exist to reverse");
        }
        const debitTotal = originalEntries
          .filter((entry) => entry.direction === "debit")
          .reduce((total, entry) => total + entry.amountCents, 0);
        const creditTotal = originalEntries
          .filter((entry) => entry.direction === "credit")
          .reduce((total, entry) => total + entry.amountCents, 0);
        if (debitTotal !== paymentRecord.amountCents || debitTotal !== creditTotal) {
          throw new DisputeError(
            409,
            "Original ledger entries are not balanced; refund was not recorded"
          );
        }

        await LedgerEntry.create(
          originalEntries.map((entry) => ({
            transactionId: String(providerRefund?.id || `refund_${paymentRecord._id}`),
            order: orderRecord._id,
            account: entry.account,
            direction: entry.direction === "debit" ? "credit" : "debit",
            amountCents: entry.amountCents,
            currency: entry.currency,
            idempotencyKey: `${paymentRecord.provider}:${paymentRecord.providerReference}:refund:${entry.account}:${entry.direction}`
          })),
          { session, ordered: true }
        );

        paymentRecord.status = "refunded";
        await paymentRecord.save({ session });
        orderRecord.status = "Refunded";
        orderRecord.statusHistory.push({
          status: "Refunded",
          changedBy: adminId,
          changedByRole: "admin"
        });
        await orderRecord.save({ session });
        updatedOrder = orderRecord.toObject();
      }

      current.status = action;
      current.resolution =
        action === "Under review"
          ? "Assigned for administrative review."
          : action === "Refunded"
            ? "Payment refunded and ledger entries reversed."
            : "Resolved by an administrator.";
      current.resolvedBy = adminId;
      current.resolvedAt = new Date();
      await current.save({ session });
      updatedDispute = current;
    });
  } catch (error) {
    if (error.code === 11000 && action === "Refunded") {
      const concurrent = await Dispute.findById(disputeId);
      if (concurrent?.status === "Refunded") {
        return { dispute: concurrent, duplicate: true };
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  if (updatedOrder) emitOrderUpdated(updatedOrder);
  return { dispute: updatedDispute, duplicate };
}
