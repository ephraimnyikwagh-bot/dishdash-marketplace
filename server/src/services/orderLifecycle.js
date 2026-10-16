import mongoose from "mongoose";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Product from "../models/Product.js";
import { emitOrderUpdated } from "./realtime.js";

export class OrderTransitionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function actorFilter(actor, status) {
  if (status === "Shipped" && actor.role === "vendor") {
    return { vendor: actor.id };
  }
  if (status === "Cancelled" && actor.role === "buyer") {
    return { buyer: actor.id };
  }
  if (status === "Delivered" && actor.role === "courier") {
    return { courier: actor.id };
  }
  return null;
}

const transitions = {
  vendor: { Paid: "Shipped" },
  buyer: { Pending: "Cancelled" },
  courier: { Shipped: "Delivered" }
};

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
  if (!Object.values(transitions[actor.role] || {}).includes(status)) {
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

      const requiredStatus = Object.entries(transitions[actor.role]).find(
        ([, nextStatus]) => nextStatus === status
      )?.[0];
      if (!requiredStatus || current.status !== requiredStatus) {
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
