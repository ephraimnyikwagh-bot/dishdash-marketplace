import { createFlutterwaveProvider } from "./flutterwave.js";
import { createMockProvider } from "./mock.js";

export function createPaymentProvider(name = process.env.PAYMENT_PROVIDER || "mock") {
  if (name === "mock") return createMockProvider();
  if (name === "flutterwave") return createFlutterwaveProvider();
  throw new Error(`Unsupported payment provider: ${name}`);
}
