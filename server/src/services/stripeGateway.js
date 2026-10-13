import Stripe from "stripe";

export function createStripeGateway() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith("sk_test_")) {
    const error = new Error(
      "Stripe sandbox is not configured. Set STRIPE_SECRET_KEY to a Stripe test-mode key."
    );
    error.statusCode = 503;
    throw error;
  }

  const stripe = new Stripe(secretKey);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  return {
    async createPaymentIntent({
      amountCents,
      currency,
      idempotencyKey,
      metadata
    }) {
      return stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata
        },
        { idempotencyKey }
      );
    },
    retrievePaymentIntent(intentId) {
      return stripe.paymentIntents.retrieve(intentId);
    },
    cancelPaymentIntent(intentId) {
      return stripe.paymentIntents.cancel(intentId);
    },
    constructWebhookEvent(rawBody, signature) {
      if (!webhookSecret) {
        const error = new Error(
          "Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET."
        );
        error.statusCode = 503;
        throw error;
      }
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    }
  };
}
