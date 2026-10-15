import { timingSafeEqual } from "node:crypto";

const SANDBOX_API = "https://api.flutterwave.com/v3";

function getConfiguration() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Flutterwave payments are restricted to non-production test mode");
  }

  const secretKey = process.env.FLW_SECRET_KEY;
  const publicKey = process.env.FLW_PUBLIC_KEY;
  const webhookHash = process.env.FLW_WEBHOOK_HASH;
  if (!secretKey || !publicKey || !webhookHash) {
    throw new Error(
      "Set FLW_SECRET_KEY, FLW_PUBLIC_KEY, and FLW_WEBHOOK_HASH to Flutterwave test credentials"
    );
  }
  if (!secretKey.startsWith("FLWSECK_TEST-") || !publicKey.startsWith("FLWPUBK_TEST-")) {
    throw new Error("Only Flutterwave TEST-mode credentials are supported");
  }

  const configuredApi = process.env.FLW_BASE_URL || SANDBOX_API;
  if (configuredApi !== SANDBOX_API) {
    throw new Error("FLW_BASE_URL must use the Flutterwave sandbox API URL");
  }

  return { secretKey, publicKey, webhookHash, api: SANDBOX_API };
}

async function requestJson(url, secretKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const payload = await response.json();
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || `Flutterwave request failed (${response.status})`);
  }
  return payload.data;
}

export function createFlutterwaveProvider() {
  const config = getConfiguration();
  return {
    name: "flutterwave",
    publicKey: config.publicKey,
    async createIntent({ amountCents, currency, idempotencyKey, email, name }) {
      const txRef = `dishdash-${idempotencyKey}`;
      const data = await requestJson(`${config.api}/payments`, config.secretKey, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          tx_ref: txRef,
          amount: (amountCents / 100).toFixed(2),
          currency,
          redirect_url: process.env.FLW_REDIRECT_URL || "http://localhost:5173/payment/return",
          customer: { email, name },
          customizations: { title: "DishDash", description: "Food marketplace order" },
          meta: { idempotency_key: idempotencyKey }
        })
      });
      if (!data?.link) throw new Error("Flutterwave did not return a payment link");
      return {
        id: txRef,
        amountCents,
        currency,
        status: "pending",
        paymentUrl: data.link
      };
    },
    async verifyTransaction(transactionId) {
      return requestJson(
        `${config.api}/transactions/${encodeURIComponent(transactionId)}/verify`,
        config.secretKey
      );
    },
    verifyWebhookSignature(signature) {
      if (typeof signature !== "string") return false;
      const expected = Buffer.from(config.webhookHash);
      const actual = Buffer.from(signature);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    }
  };
}
