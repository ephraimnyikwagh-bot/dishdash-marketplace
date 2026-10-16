import mongoose from "mongoose";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import { createPaymentProvider } from "./payments/index.js";
import { getEscrowBalanceCents, releaseEscrowInSession } from "./escrow.js";
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
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, buyer: buyerId }).session(session);
      if (!order) throw new DisputeError(404, "Order not found");
      if (!["Paid", "Shipped", "Ready for pickup", "Delivered"].includes(order.status)) {
        throw new DisputeError(
          409,
          "A dispute can only be raised for a paid, in-progress, or delivered order"
        );
      }
      order.escrowVersion += 1;
      await order.save({ session });
      [created] = await Dispute.create(
        [{
          order: order._id,
          buyer: buyerId,
          reason: reason.trim(),
          origin: "buyer",
          status: "Open"
        }],
        { session }
      );
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new DisputeError(409, "A dispute already exists for this order");
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return created;
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
          status: { $in: ["Paid", "Shipped", "Ready for pickup", "Delivered"] }
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

        const hold = await LedgerEntry.findOne({
          order: current.order,
          account: "escrow",
          direction: "credit",
          idempotencyKey: `${current.order}:escrow:hold`
        }).session(session);
        if (!hold || hold.amountCents !== paymentRecord.amountCents) {
          throw new DisputeError(409, "No original ledger entries exist to reverse");
        }
        const released = await LedgerEntry.exists({
          order: orderRecord._id,
          idempotencyKey: `${orderRecord._id}:escrow:release`
        }).session(session);
        if (!released && (await getEscrowBalanceCents(session, orderRecord.currency)) < paymentRecord.amountCents) {
          throw new DisputeError(409, "Escrow balance is insufficient to refund this order");
        }
        const refundEntries = released
          ? [
              {
                account: "buyer_payment",
                direction: "credit",
                amountCents: paymentRecord.amountCents,
                key: "buyer-payment"
              },
              ...(orderRecord.subtotalCents > orderRecord.platformFeeCents
                ? [{
                    account: "seller_payable",
                    direction: "debit",
                    amountCents: orderRecord.subtotalCents - orderRecord.platformFeeCents,
                    key: "seller-payable",
                    owner: orderRecord.vendor
                  }]
                : []),
              ...(orderRecord.platformFeeCents
                ? [{
                    account: "platform_fee_revenue",
                    direction: "debit",
                    amountCents: orderRecord.platformFeeCents,
                    key: "platform-fee",
                    owner: orderRecord.vendor
                  }]
                : [])
            ]
          : [
              {
                account: "escrow",
                direction: "debit",
                amountCents: paymentRecord.amountCents,
                key: "escrow"
              },
              {
                account: "buyer_payment",
                direction: "credit",
                amountCents: paymentRecord.amountCents,
                key: "buyer-payment"
              }
            ];

        await LedgerEntry.create(
          refundEntries.map((entry) => ({
            transactionId: String(providerRefund?.id || `refund_${paymentRecord._id}`),
            order: orderRecord._id,
            owner: orderRecord.vendor,
            account: entry.account,
            direction: entry.direction,
            amountCents: entry.amountCents,
            currency: orderRecord.currency,
            idempotencyKey: `${orderRecord._id}:refund:${entry.key}`
          })),
          { session, ordered: true }
        );

        paymentRecord.status = "refunded";
        await paymentRecord.save({ session });
        orderRecord.status = "Refunded";
        orderRecord.escrowStatus = "refunded";
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
      if (action === "Resolved") {
        const pickupOrder = await Order.findById(current.order).session(session);
        if (
          pickupOrder?.status === "Delivered" &&
          (pickupOrder.deliveryMethod === "pickup" || pickupOrder.buyerConfirmedAt)
        ) {
          await releaseEscrowInSession(pickupOrder, session, { immediate: true });
          updatedOrder = pickupOrder.toObject();
        }
      }
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
