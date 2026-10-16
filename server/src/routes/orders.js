import { Router } from "express";
import { query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import { ensureReceipt } from "../services/receipts.js";
import { releaseMatureEscrows } from "../services/escrow.js";
import Dispute from "../models/Dispute.js";
import Review from "../models/Review.js";
import {
  confirmDeliveryReceived,
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
    await releaseMatureEscrows({
      buyerId: request.auth.role === "buyer" ? request.auth.id : undefined,
      sellerId: request.auth.role === "vendor" ? request.auth.id : undefined
    });
    let filter = {};
    if (request.auth.role === "buyer") {
      filter.buyer = request.auth.id;
    } else if (request.auth.role === "vendor") {
      const orderIds = await OrderItem.distinct("order", {
        vendor: request.auth.id
      });
      filter = {
        _id: { $in: orderIds },
        status: { $in: ["Paid", "Shipped", "Ready for pickup", "Delivered"] }
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
    await releaseMatureEscrows({
      buyerId: request.auth.role === "buyer" ? request.auth.id : undefined,
      sellerId: request.auth.role === "vendor" ? request.auth.id : undefined
    });
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
    if (request.auth.role === "admin" && order.status === "Delivered" && order.escrowStatus === "held") {
      await releaseMatureEscrows();
      Object.assign(order, await Order.findById(order._id).lean());
    }

    const [items, openDispute, existingReview] = await Promise.all([
      OrderItem.find({ order: order._id }).lean(),
      Dispute.exists({ order: order._id, status: { $in: ["Open", "Under review"] } }),
      Review.exists({ order: order._id })
    ]);
    order.hasOpenDispute = Boolean(openDispute);
    order.hasReview = Boolean(existingReview);
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

router.get(
  "/:orderId/receipt",
  requireAuth,
  allowRoles("buyer", "vendor", "admin"),
  async (request, response, next) => {
    try {
      const order = await Order.findById(request.params.orderId)
        .select("buyer vendor status")
        .lean();
      if (!order) {
        response.status(404).json({ message: "Order not found" });
        return;
      }
      const authorized =
        request.auth.role === "admin" ||
        (request.auth.role === "buyer" &&
          String(order.buyer) === request.auth.id) ||
        (request.auth.role === "vendor" &&
          String(order.vendor) === request.auth.id);
      if (!authorized) {
        response.status(404).json({ message: "Receipt not found" });
        return;
      }
      if (!["Paid", "Shipped", "Ready for pickup", "Delivered", "Refunded"].includes(order.status)) {
        response.status(409).json({ message: "Receipt is available after payment" });
        return;
      }

      const saved = await ensureReceipt(order._id);
      response
        .type("application/pdf")
        .set(
          "Content-Disposition",
          `attachment; filename="${saved.receiptNumber}.pdf"`
        )
        .send(saved.pdfData);
    } catch (error) {
      next(error);
    }
  }
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

router.post(
  "/:orderId/confirm-received",
  requireAuth,
  allowRoles("buyer"),
  async (request, response, next) => {
    try {
      const order = await confirmDeliveryReceived({
        orderId: request.params.orderId,
        buyerId: request.auth.id
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
