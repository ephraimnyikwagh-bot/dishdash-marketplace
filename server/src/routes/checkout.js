import { Router } from "express";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import {
  CheckoutError,
  createCheckout,
  processStripeEvent
} from "../services/checkout.js";
import { createStripeGateway } from "../services/stripeGateway.js";

export function createCheckoutRouter({
  gatewayFactory = createStripeGateway
} = {}) {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    allowRoles("buyer"),
    async (request, response, next) => {
      const clientIdempotencyKey = request.get("Idempotency-Key");
      if (
        !clientIdempotencyKey ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(clientIdempotencyKey)
      ) {
        response.status(400).json({
          message: "A valid Idempotency-Key header is required"
        });
        return;
      }

      try {
        const result = await createCheckout({
          buyerId: request.auth.id,
          clientIdempotencyKey,
          gateway: gatewayFactory()
        });
        response.status(result.reused ? 200 : 201).json({
          order: result.order,
          payment: {
            id: result.payment.id,
            status: result.payment.status,
            amountCents: result.payment.amountCents,
            currency: result.payment.currency
          },
          clientSecret: result.clientSecret
        });
      } catch (error) {
        if (error instanceof CheckoutError) {
          response.status(error.statusCode).json({ message: error.message });
          return;
        }
        next(error);
      }
    }
  );

  return router;
}

export function createStripeWebhookRouter({
  gatewayFactory = createStripeGateway
} = {}) {
  const router = Router();

  router.post("/", async (request, response, next) => {
    if (!Buffer.isBuffer(request.body)) {
      response
        .status(400)
        .json({ message: "Expected raw Stripe webhook body" });
      return;
    }

    try {
      const gateway = gatewayFactory();
      const event = gateway.constructWebhookEvent(
        request.body,
        request.get("stripe-signature")
      );
      const result = await processStripeEvent({ event });
      response.json({ received: true, ...result });
    } catch (error) {
      if (error instanceof CheckoutError) {
        response.status(error.statusCode).json({ message: error.message });
        return;
      }
      if (error.type === "StripeSignatureVerificationError") {
        response
          .status(400)
          .json({ message: "Invalid Stripe webhook signature" });
        return;
      }
      next(error);
    }
  });

  return router;
}
