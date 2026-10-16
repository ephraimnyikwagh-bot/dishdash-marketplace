import { randomUUID } from "node:crypto";

const intents = new Map();
const refunds = new Map();

export function createMockProvider() {
  return {
    name: "mock",
    async createIntent({ amountCents, currency, idempotencyKey }) {
      if (intents.has(idempotencyKey)) return intents.get(idempotencyKey);

      const intent = {
        id: `mock_${randomUUID()}`,
        amountCents,
        currency,
        status: "pending",
        paymentUrl: null
      };
      intents.set(idempotencyKey, intent);
      return intent;
    },
    async verifyTransaction(reference) {
      const intent = [...intents.values()].find((item) => item.id === reference);
      return intent || null;
    },
    async simulate(reference, status) {
      const intent = [...intents.values()].find((item) => item.id === reference);
      if (!intent) return null;
      intent.status = status;
      return intent;
    },
    async refund({ reference, amountCents, idempotencyKey }) {
      if (refunds.has(idempotencyKey)) return refunds.get(idempotencyKey);
      const intent = [...intents.values()].find((item) => item.id === reference);
      if (intent && intent.status !== "succeeded") {
        throw new Error("Only successful mock payments can be refunded");
      }
      const refund = {
        id: `mock_refund_${randomUUID()}`,
        reference,
        amountCents,
        status: "refunded"
      };
      if (intent) intent.status = "refunded";
      refunds.set(idempotencyKey, refund);
      return refund;
    }
  };
}
