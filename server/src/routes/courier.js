import { Router } from "express";
import { query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import {
  acceptDelivery,
  OrderTransitionError,
  transitionOrder
} from "../services/orderLifecycle.js";

const router = Router();
const pagination = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 })
];

function sendErrors(request, response) {
  const errors = validationResult(request);
  if (errors.isEmpty()) return false;
  response.status(400).json({ errors: errors.array() });
  return true;
}

function handleError(error, response, next) {
  if (error instanceof OrderTransitionError) {
    response.status(error.statusCode).json({ message: error.message });
    return;
  }
  next(error);
}

router.use(requireAuth, allowRoles("courier"));

router.get("/available", pagination, async (request, response, next) => {
  if (sendErrors(request, response)) return;
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 10);
  try {
    const filter = { status: "Shipped", courier: null };
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ updatedAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
    ]);
    const orderIds = orders.map((order) => order._id);
    const items = await OrderItem.find({ order: { $in: orderIds } }).lean();
    const itemsByOrder = new Map();
    for (const item of items) {
      const key = String(item.order);
      itemsByOrder.set(key, [...(itemsByOrder.get(key) || []), item]);
    }
    response.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: orders.map((order) => ({
        ...order,
        items: itemsByOrder.get(String(order._id)) || []
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/deliveries", pagination, async (request, response, next) => {
  if (sendErrors(request, response)) return;
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 10);
  const filter = {
    courier: request.auth.id,
    status: { $in: ["Shipped", "Delivered"] }
  };
  try {
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
    ]);
    const items = await OrderItem.find({
      order: { $in: orders.map((order) => order._id) }
    }).lean();
    const itemsByOrder = new Map();
    for (const item of items) {
      const key = String(item.order);
      itemsByOrder.set(key, [...(itemsByOrder.get(key) || []), item]);
    }
    response.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: orders.map((order) => ({
        ...order,
        items: itemsByOrder.get(String(order._id)) || []
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:orderId/accept", async (request, response, next) => {
  try {
    const order = await acceptDelivery({
      orderId: request.params.orderId,
      courierId: request.auth.id
    });
    response.json({ order });
  } catch (error) {
    handleError(error, response, next);
  }
});

router.post("/:orderId/delivered", async (request, response, next) => {
  try {
    const order = await transitionOrder({
      orderId: request.params.orderId,
      actor: request.auth,
      status: "Delivered"
    });
    response.json({ order });
  } catch (error) {
    handleError(error, response, next);
  }
});

export default router;
