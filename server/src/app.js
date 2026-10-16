import express from "express";
import cors from "cors";
import helmet from "helmet";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import productsRoutes from "./routes/products.js";
import cartRoutes from "./routes/cart.js";
import { createCheckoutRouter } from "./routes/checkout.js";
import { createPaymentsRouter } from "./routes/payments.js";
import ordersRoutes from "./routes/orders.js";
import ledgerRoutes from "./routes/ledger.js";
import courierRoutes from "./routes/courier.js";
import adminRoutes from "./routes/admin.js";
import disputeRoutes from "./routes/disputes.js";

const app = express();
const uploadsDirectory = fileURLToPath(new URL("../uploads/", import.meta.url));

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "data:", "https:"]
      }
    }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  })
);
app.use(express.json({ limit: "20kb" }));
app.use("/uploads", express.static(uploadsDirectory, {
  fallthrough: true,
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  immutable: false,
  dotfiles: "deny",
  index: false
}));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/checkout", createCheckoutRouter());
app.use("/api/payments", createPaymentsRouter());
app.use("/api/orders", ordersRoutes);
app.use("/api/courier", courierRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/disputes", disputeRoutes);

app.use((error, _request, response, _next) => {
  console.error("Unhandled API error:", error);
  if (error.statusCode === 503) {
    response.status(503).json({ message: error.message });
    return;
  }
  response.status(500).json({ message: "Internal server error" });
});

export default app;
