import { Router } from "express";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import { CheckoutError, createCheckout } from "../services/checkout.js";
import { createPaymentProvider } from "../services/payments/index.js";

export function createCheckoutRouter({
  providerFactory = createPaymentProvider
} = {}) {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    allowRoles("buyer"),
    async (request, response, next) => {
      const clientKey = request.get("Idempotency-Key");
      if (!clientKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(clientKey)) {
        response.status(400).json({
          message: "A valid Idempotency-Key header is required"
        });
        return;
      }

      try {
        const result = await createCheckout({
          buyerId: request.auth.id,
          clientIdempotencyKey: clientKey,
          provider: providerFactory()
        });
        response.status(result.reused ? 200 : 201).json({
          order: result.order,
          payment: {
            id: result.payment.id,
            provider: result.payment.provider,
            reference: result.payment.providerReference,
            status: result.payment.status,
            amountCents: result.payment.amountCents,
            currency: result.payment.currency,
            paymentUrl: result.payment.paymentUrl
          }
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
