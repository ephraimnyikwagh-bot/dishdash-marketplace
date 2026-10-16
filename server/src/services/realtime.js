import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Order from "../models/Order.js";

let socketServer = null;

export function initializeRealtime(httpServer, options = {}) {
  const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim());
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"]
    },
    ...options
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const secret = process.env.JWT_SECRET;
    if (!token || !secret || secret.length < 32) {
      next(new Error("Authentication required"));
      return;
    }

    try {
      const payload = jwt.verify(token, secret, {
        issuer: "food-marketplace-api",
        audience: "food-marketplace"
      });
      if (
        typeof payload === "string" ||
        !payload.sub ||
        !["buyer", "vendor", "courier", "admin"].includes(payload.role)
      ) {
        next(new Error("Invalid authentication token"));
        return;
      }
      socket.data.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    socket.on("order:join", async (orderId, acknowledge = () => {}) => {
      if (!mongoose.isValidObjectId(orderId)) {
        acknowledge({ joined: false, message: "Invalid order ID" });
        return;
      }

      try {
        const order = await Order.findById(orderId).select(
          "buyer vendor courier"
        );
        if (!order) {
          acknowledge({ joined: false, message: "Order not found" });
          return;
        }
        const { id, role } = socket.data.user;
        const authorized =
          role === "admin" ||
          (role === "buyer" && String(order.buyer) === id) ||
          (role === "vendor" && String(order.vendor) === id) ||
          (role === "courier" && String(order.courier) === id);
        if (!authorized) {
          acknowledge({ joined: false, message: "Order access denied" });
          return;
        }
        socket.join(`order:${orderId}`);
        acknowledge({ joined: true });
      } catch {
        acknowledge({ joined: false, message: "Could not join order updates" });
      }
    });
    socket.on("order:leave", (orderId) => {
      if (typeof orderId === "string") socket.leave(`order:${orderId}`);
    });
  });

  socketServer = io;
  return io;
}

export function emitOrderUpdated(order) {
  if (!socketServer || !order) return;
  const orderId = String(order._id);
  const payload = {
    orderId,
    status: order.status,
    courier: order.courier ? String(order.courier) : null,
    statusHistory: order.statusHistory || [],
    updatedAt: order.updatedAt || new Date()
  };
  const rooms = [`order:${orderId}`];
  for (const userId of [order.buyer, order.vendor, order.courier]) {
    if (userId) rooms.push(`user:${String(userId)}`);
  }
  socketServer.to(rooms).emit("order:updated", payload);
}

export function resetRealtime() {
  socketServer = null;
}
