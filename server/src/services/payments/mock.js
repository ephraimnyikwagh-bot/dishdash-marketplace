import { randomUUID } from "node:crypto";

const intents = new Map();

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
    }
  };
}
