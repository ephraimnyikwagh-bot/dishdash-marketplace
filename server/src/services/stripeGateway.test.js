import { createStripeGateway } from "./stripeGateway.js";

describe("Stripe sandbox gateway configuration", () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecret;
    }
  });

  test("rejects a live-mode secret key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_not-allowed";

    expect(() => createStripeGateway()).toThrow(
      "Stripe sandbox is not configured"
    );
  });

  test("accepts a Stripe test-mode secret key", () => {
    process.env.STRIPE_SECRET_KEY =
      "sk_test_1234567890abcdefghijklmnopqrstuvwxyz";

    expect(createStripeGateway()).toEqual(
      expect.objectContaining({
        createPaymentIntent: expect.any(Function),
        constructWebhookEvent: expect.any(Function)
      })
    );
  });
});
