import { Router } from "express";
import { query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import {
  OrderTransitionError,
  transitionOrder
} from "../services/orderLifecycle.js";

const router = Router();
const pagination = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 })
];

function invalidQuery(request, response) {
  const errors = validationResult(request);
  if (!errors.isEmpty()) {
    response.status(400).json({ errors: errors.array() });
    return true;
  }
  return false;
}

async function listOrders(request, response, next) {
  if (invalidQuery(request, response)) return;
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 10);

  try {
    let filter = {};
    if (request.auth.role === "buyer") {
      filter.buyer = request.auth.id;
    } else if (request.auth.role === "vendor") {
      const orderIds = await OrderItem.distinct("order", {
        vendor: request.auth.id
      });
      filter = {
        _id: { $in: orderIds },
        status: { $in: ["Paid", "Shipped", "Delivered"] }
      };
    } else if (request.auth.role === "courier") {
      filter.courier = request.auth.id;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("payment", "provider status amountCents currency")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
    ]);
    response.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders
    });
  } catch (error) {
    next(error);
  }
}

async function getOrder(request, response, next) {
  try {
    const order = await Order.findById(request.params.orderId)
      .populate("payment", "provider status amountCents currency")
      .lean();
    if (!order) {
      response.status(404).json({ message: "Order not found" });
      return;
    }

    if (
      request.auth.role === "buyer" &&
      String(order.buyer) !== request.auth.id
    ) {
      response.status(404).json({ message: "Order not found" });
      return;
    }
    if (
      request.auth.role === "vendor" &&
      !(
        await OrderItem.exists({
          order: order._id,
          vendor: request.auth.id
        })
      )
    ) {
      response.status(404).json({ message: "Order not found" });
      return;
    }
    if (
      request.auth.role === "courier" &&
      String(order.courier || "") !== request.auth.id
    ) {
      response.status(404).json({ message: "Order not found" });
      return;
    }

    const items = await OrderItem.find({ order: order._id }).lean();
    response.json({ order, items });
  } catch (error) {
    next(error);
  }
}

router.get(
  "/",
  requireAuth,
  allowRoles("buyer", "vendor", "courier", "admin"),
  pagination,
  listOrders
);
router.get(
  "/:orderId",
  requireAuth,
  allowRoles("buyer", "vendor", "courier", "admin"),
  getOrder
);

router.patch(
  "/:orderId/status",
  requireAuth,
  allowRoles("buyer", "vendor", "courier"),
  async (request, response, next) => {
    const { status } = request.body || {};
    if (typeof status !== "string") {
      response.status(400).json({ message: "A target status is required" });
      return;
    }
    try {
      const order = await transitionOrder({
        orderId: request.params.orderId,
        actor: request.auth,
        status
      });
      response.json({ order });
    } catch (error) {
      if (error instanceof OrderTransitionError) {
        response.status(error.statusCode).json({ message: error.message });
        return;
      }
      next(error);
    }
  }
);

export default router;
