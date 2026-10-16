import mongoose from "mongoose";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Product from "../models/Product.js";
import { getEscrowAutoReleaseDays, releaseEscrowInSession } from "./escrow.js";
import { emitOrderUpdated } from "./realtime.js";

export class OrderTransitionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function actorFilter(actor, status) {
  if (["Shipped", "Ready for pickup"].includes(status) && actor.role === "vendor") {
    return { vendor: actor.id };
  }
  if (status === "Cancelled" && actor.role === "buyer") {
    return { buyer: actor.id };
  }
  if (status === "Delivered" && actor.role === "courier") {
    return { courier: actor.id };
  }
  if (status === "Delivered" && actor.role === "buyer") {
    return { buyer: actor.id };
  }
  return null;
}

export async function transitionOrder({ orderId, actor, status }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new OrderTransitionError(400, "Invalid order ID");
  }
  const filterByActor = actorFilter(actor, status);
  if (!filterByActor) {
    throw new OrderTransitionError(
      403,
      "Your role is not allowed to perform this order transition"
    );
  }
  const allowedTargets = {
    vendor: ["Shipped", "Ready for pickup"],
    buyer: ["Cancelled", "Delivered"],
    courier: ["Delivered"]
  };
  if (!allowedTargets[actor.role]?.includes(status)) {
    throw new OrderTransitionError(400, "Requested order status is not supported");
  }

  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const current = await Order.findOne({
        _id: orderId,
        ...filterByActor
      }).session(session);
      if (!current) {
        const exists = await Order.exists({ _id: orderId }).session(session);
        if (!exists) throw new OrderTransitionError(404, "Order not found");
        throw new OrderTransitionError(404, "Order not found for this account");
      }

      const requiredStatus =
        status === "Cancelled" ? "Pending" :
          status === "Delivered" && actor.role === "buyer" ? "Ready for pickup" :
            status === "Delivered" ? "Shipped" : "Paid";
      const methodAllowed =
        (status === "Ready for pickup" || (status === "Delivered" && actor.role === "buyer"))
          ? current.deliveryMethod === "pickup"
          : status === "Shipped" || (status === "Delivered" && actor.role === "courier")
            ? current.deliveryMethod === "delivery"
            : true;
      if (!methodAllowed) {
        throw new OrderTransitionError(409, "That action does not match the order's delivery method");
      }
      if (current.status !== requiredStatus) {
        throw new OrderTransitionError(
          409,
          `Cannot change order from ${current.status} to ${status}; the allowed transition is ${requiredStatus} to ${status}`
        );
      }

      const changed = await Order.findOneAndUpdate(
        {
          _id: current._id,
          status: requiredStatus,
          ...filterByActor
        },
        {
          $set: { status },
          $push: {
            statusHistory: {
              status,
              changedBy: actor.id,
              changedByRole: actor.role,
              changedAt: new Date()
            }
          }
        },
        { new: true, session }
      );
      if (!changed) {
        throw new OrderTransitionError(
          409,
          "The order changed before your update could be applied. Refresh and try again."
        );
      }

      if (status === "Cancelled") {
        const items = await OrderItem.find({ order: current._id }).session(
          session
        );
        for (const item of items) {
          const restored = await Product.updateOne(
            { _id: item.product },
            { $inc: { stock: item.quantity } },
            { session }
          );
          if (restored.matchedCount !== 1) {
            throw new Error(`Could not restore stock for product ${item.product}`);
          }
        }
      }
      if (status === "Delivered") {
        if (current.deliveryMethod === "pickup") {
          await releaseEscrowInSession(changed, session, { immediate: true });
        } else {
          const days = getEscrowAutoReleaseDays();
          changed.escrowReleaseAt = new Date(
            Date.now() + days * 24 * 60 * 60 * 1000
          );
          await changed.save({ session });
        }
      }
      updated = changed.toObject();
    });
  } finally {
    await session.endSession();
  }

  emitOrderUpdated(updated);
  return updated;
}

export async function acceptDelivery({ orderId, courierId }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new OrderTransitionError(400, "Invalid order ID");
  }

  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: "Shipped", courier: null },
    { $set: { courier: courierId } },
    { new: true }
  );
  if (order) {
    const value = order.toObject();
    emitOrderUpdated(value);
    return value;
  }

  const existing = await Order.findById(orderId);
  if (!existing) throw new OrderTransitionError(404, "Order not found");
  if (existing.status !== "Shipped") {
    throw new OrderTransitionError(
      409,
      `Only Shipped orders can be accepted; this order is ${existing.status}`
    );
  }
  if (existing.courier) {
    throw new OrderTransitionError(409, "This delivery has already been accepted");
  }
  throw new OrderTransitionError(409, "Could not assign this delivery; try again");
}

export async function confirmDeliveryReceived({ orderId, buyerId }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new OrderTransitionError(400, "Invalid order ID");
  }
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, buyer: buyerId }).session(session);
      if (!order) throw new OrderTransitionError(404, "Order not found");
      if (order.deliveryMethod !== "delivery" || order.status !== "Delivered") {
        throw new OrderTransitionError(409, "Only a delivered delivery order can be confirmed");
      }
      if (order.escrowStatus === "released") {
        updated = order.toObject();
        return;
      }
      if (order.escrowStatus !== "held") {
        throw new OrderTransitionError(409, "This order has no held payment to release");
      }
      order.buyerConfirmedAt = new Date();
      const released = await releaseEscrowInSession(order, session, { immediate: true });
      if (!released) {
        throw new OrderTransitionError(409, "An open dispute is holding this payment");
      }
      updated = order.toObject();
    });
  } finally {
    await session.endSession();
  }
  emitOrderUpdated(updated);
  return updated;
}
