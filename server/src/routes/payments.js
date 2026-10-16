import { randomUUID } from "node:crypto";
import { Router } from "express";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import { CheckoutError, processPaymentEvent } from "../services/checkout.js";
import { createPaymentProvider } from "../services/payments/index.js";

export function createPaymentsRouter({
  providerFactory = createPaymentProvider,
  environment = () => process.env.NODE_ENV
} = {}) {
  const router = Router();

  router.get(
    "/:paymentId",
    requireAuth,
    allowRoles("buyer"),
    async (request, response, next) => {
      try {
        const payment = await Payment.findById(request.params.paymentId)
          .select("order provider providerReference paymentUrl amountCents currency status")
          .lean();
        if (!payment) {
          response.status(404).json({ message: "Payment not found" });
          return;
        }
        const order = await Order.findById(payment.order)
          .select("buyer status totalCents currency")
          .lean();
        if (!order || String(order.buyer) !== request.auth.id) {
          response.status(404).json({ message: "Payment not found" });
          return;
        }
        response.json({ payment, order });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/:paymentId/simulate",
    requireAuth,
    allowRoles("buyer"),
    async (request, response, next) => {
      if (environment() === "production") {
        response.status(404).json({ message: "Not found" });
        return;
      }
      const { outcome } = request.body || {};
      if (!["succeeded", "failed", "expired"].includes(outcome)) {
        response.status(400).json({
          message: "Outcome must be succeeded, failed, or expired"
        });
        return;
      }

      try {
        const payment = await Payment.findById(request.params.paymentId);
        if (!payment) {
          response.status(404).json({ message: "Payment not found" });
          return;
        }
        const order = await Order.findById(payment.order);
        if (!order || String(order.buyer) !== request.auth.id) {
          response.status(404).json({ message: "Payment not found" });
          return;
        }
        if (payment.provider !== "mock") {
          response.status(409).json({
            message: "Payment simulation is only available for mock payments"
          });
          return;
        }

        const provider = providerFactory();
        const intent = await provider.simulate(
          payment.providerReference,
          outcome
        );
        if (!intent) {
          response.status(404).json({ message: "Mock payment intent not found" });
          return;
        }
        const result = await processPaymentEvent({
          providerName: "mock",
          eventId: `mock_${intent.id}_${outcome}_${randomUUID()}`,
          reference: intent.id,
          outcome
        });
        response.json({ received: true, outcome, ...result });
      } catch (error) {
        if (error instanceof CheckoutError) {
          response.status(error.statusCode).json({ message: error.message });
          return;
        }
        next(error);
      }
    }
  );

  router.post("/webhook", async (request, response, next) => {
    try {
      const provider = providerFactory();
      if (provider.name !== "flutterwave") {
        response.status(404).json({ message: "Not found" });
        return;
      }

      if (!provider.verifyWebhookSignature(request.get("verif-hash"))) {
        response.status(401).json({ message: "Invalid payment webhook signature" });
        return;
      }

      const data = request.body?.data;
      const reference = data?.tx_ref;
      const transactionId = data?.id;
      if (!reference || !transactionId) {
        response.status(400).json({ message: "Invalid Flutterwave webhook payload" });
        return;
      }

      const payment = await Payment.findOne({
        provider: "flutterwave",
        providerReference: reference
      });
      if (!payment) {
        response.status(404).json({ message: "Payment was not found" });
        return;
      }

      const transaction = await provider.verifyTransaction(transactionId);
      const validTransaction =
        transaction?.tx_ref === reference &&
        String(transaction.currency).toUpperCase() === payment.currency &&
        Math.round(Number(transaction.amount) * 100) === payment.amountCents;
      if (!validTransaction) {
        response.status(400).json({
          message: "Flutterwave transaction details do not match the payment"
        });
        return;
      }

      const eventStatus = String(request.body?.event || data.status || "").toLowerCase();
      let outcome;
      if (eventStatus === "charge.completed") {
        outcome =
          String(transaction.status).toLowerCase() === "successful"
            ? "succeeded"
            : "failed";
      } else if (["failed", "cancelled", "expired"].includes(eventStatus)) {
        outcome = eventStatus === "expired" ? "expired" : "failed";
      } else {
        response.json({ received: true, ignored: true });
        return;
      }

      const result = await processPaymentEvent({
        providerName: "flutterwave",
        eventId: String(request.body.id || `flw_${transactionId}_${eventStatus}`),
        reference,
        providerTransactionId: transactionId,
        outcome
      });
      response.json({ received: true, ...result });
    } catch (error) {
      if (error instanceof CheckoutError) {
        response.status(error.statusCode).json({ message: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}
