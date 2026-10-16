import autocannon from "autocannon";
import bcrypt from "bcryptjs";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Product from "../src/models/Product.js";
import User from "../src/models/User.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "carted-loadtest-secret-with-at-least-32-characters";
process.env.PAYMENT_PROVIDER = "mock";
process.env.PLATFORM_FEE_BPS = "1000";

const { default: app } = await import("../src/app.js");
const baselineUsers = Number(process.env.LOAD_BASELINE_USERS || 8);
const catalogDurationSeconds = Number(process.env.LOAD_CATALOG_SECONDS || 5);
const userPassword = "CartedLoadTestOnly2026!";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let replicaSet;
let server;

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(values) {
  return {
    average: values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 0,
    p95: percentile(values, 0.95)
  };
}

async function jsonRequest(baseUrl, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${endpoint} returned ${response.status}: ${body.message || "request failed"}`);
  }
  return body;
}

async function createScenarioUsers(baseUrl, count, scenarioName) {
  const passwordHash = await bcrypt.hash(userPassword, 4);
  const users = await Promise.all(
    Array.from({ length: count }, async (_unused, index) => {
      const email = `load-${runId}-${scenarioName}-${index}@example.test`;
      await User.create({
        name: `Load test ${scenarioName} ${index}`,
        email,
        passwordHash,
        role: "buyer"
      });
      const started = performance.now();
      const result = await jsonRequest(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: userPassword })
      });
      return {
        id: result.user.id,
        token: result.token,
        loginMs: performance.now() - started
      };
    })
  );
  return users;
}

async function benchmarkCatalog(baseUrl, concurrency, token) {
  const latencySamples = [];
  const instance = autocannon({
    url: baseUrl,
    connections: concurrency,
    duration: catalogDurationSeconds,
    pipelining: 1,
    requests: [
      {
        method: "GET",
        path: "/api/products?page=1&limit=12",
        headers: { Authorization: `Bearer ${token}` }
      }
    ]
  });
  instance.on("response", (_client, _statusCode, _bytes, responseTime) => {
    latencySamples.push(responseTime);
  });
  const result = await new Promise((resolve, reject) => {
    instance.once("done", resolve);
    instance.once("error", reject);
  });
  const latency = summary(latencySamples);
  return {
    average: latency.average,
    p95: latency.p95,
    requestsPerSecond: result.requests.average,
    totalRequests: result.requests.total,
    errors: result.errors + result.timeouts + result.non2xx
  };
}

async function exerciseCheckout(baseUrl, users, productId) {
  const checkoutLatencies = [];
  const confirmationLatencies = [];
  const cartLatencies = [];
  const failures = [];

  await Promise.all(
    users.map(async (user, index) => {
      const flowStart = performance.now();
      try {
        const cartStart = performance.now();
        await jsonRequest(baseUrl, "/api/cart/items", {
          method: "POST",
          headers: { Authorization: `Bearer ${user.token}` },
          body: JSON.stringify({ productId, quantity: 1 })
        });
        cartLatencies.push(performance.now() - cartStart);

        const checkoutStart = performance.now();
        const checkout = await jsonRequest(baseUrl, "/api/checkout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${user.token}`,
            "Idempotency-Key": `load-${runId}-${index}-${Math.random().toString(36).slice(2, 10)}`
          },
          body: "{}"
        });
        checkoutLatencies.push(performance.now() - checkoutStart);
        await jsonRequest(baseUrl, `/api/payments/${checkout.payment.id}/simulate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${user.token}` },
          body: JSON.stringify({ outcome: "succeeded" })
        });
        confirmationLatencies.push(performance.now() - flowStart);
      } catch (error) {
        failures.push(error.message);
      }
    })
  );

  return {
    cart: summary(cartLatencies),
    checkout: summary(checkoutLatencies),
    confirmation: summary(confirmationLatencies),
    completed: confirmationLatencies.length,
    failures
  };
}

async function runScenario(baseUrl, count, name, productId) {
  const users = await createScenarioUsers(baseUrl, count, name);
  const catalog = await benchmarkCatalog(baseUrl, count, users[0].token);
  const checkout = await exerciseCheckout(baseUrl, users, productId);
  return {
    name,
    concurrency: count,
    login: summary(users.map((user) => user.loginMs)),
    catalog,
    ...checkout
  };
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

async function main() {
  if (!Number.isInteger(baselineUsers) || baselineUsers < 1 || baselineUsers > 8) {
    throw new Error("LOAD_BASELINE_USERS must be an integer from 1 to 8 (the 150% phase must fit the auth rate limit)");
  }
  if (!Number.isInteger(catalogDurationSeconds) || catalogDurationSeconds < 1) {
    throw new Error("LOAD_CATALOG_SECONDS must be a positive integer");
  }

  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" }
  });
  await mongoose.connect(replicaSet.getUri("carted_loadtest"));
  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const vendor = await User.create({
    name: "Load test vendor",
    email: `load-${runId}-vendor@example.test`,
    passwordHash: await bcrypt.hash(userPassword, 4),
    role: "vendor"
  });
  const product = await Product.create({
    vendor: vendor._id,
    name: "Load test listing",
    description: "Temporary item used only in the isolated load-test database.",
    category: "Electronics",
    priceCents: 250000,
    stock: 100000,
    imageUrl: "",
    isActive: true
  });

  const baseline = await runScenario(baseUrl, baselineUsers, "base", product.id);
  const increasedUsers = Math.ceil(baselineUsers * 1.5);
  const increased = await runScenario(baseUrl, increasedUsers, "plus50", product.id);

  console.log("Load test ran against an isolated, single-node MongoDB replica set.");
  console.log(`Catalog duration per scenario: ${catalogDurationSeconds}s`);
  console.log("| Scenario | Concurrent users | Catalog avg / p95 | Checkout avg / p95 | Cart-to-confirm avg / p95 | Completed |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const row of [baseline, increased]) {
    console.log(
      `| ${row.name} | ${row.concurrency} | ${formatMs(row.catalog.average)} / ${formatMs(row.catalog.p95)} | ${formatMs(row.checkout.average)} / ${formatMs(row.checkout.p95)} | ${formatMs(row.confirmation.average)} / ${formatMs(row.confirmation.p95)} | ${row.completed}/${row.concurrency} |`
    );
    console.log(
      `${row.name}: catalog ${row.catalog.totalRequests} req, ${row.catalog.requestsPerSecond.toFixed(1)} req/s, ${row.catalog.errors} errors; login avg/p95 ${formatMs(row.login.average)}/${formatMs(row.login.p95)}; cart avg/p95 ${formatMs(row.cart.average)}/${formatMs(row.cart.p95)}`
    );
    if (row.failures.length) {
      for (const failure of row.failures) console.error(`${row.name} flow failure: ${failure}`);
    }
  }
  const checkoutDelta = ((increased.checkout.p95 / baseline.checkout.p95) - 1) * 100;
  const catalogDelta = ((increased.catalog.p95 / baseline.catalog.p95) - 1) * 100;
  console.log(`150% load p95 change: catalog ${catalogDelta.toFixed(1)}%; checkout ${checkoutDelta.toFixed(1)}%.`);
  console.log(`3-second cart-to-payment target at 150% load: ${increased.confirmation.p95 <= 3000 ? "met" : "not met"}.`);
  if (
    baseline.completed !== baseline.concurrency ||
    increased.completed !== increased.concurrency ||
    baseline.catalog.errors ||
    increased.catalog.errors
  ) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`Load test failed: ${error.name}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (server?.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
  if (mongoose.connection.readyState) await mongoose.disconnect();
  if (replicaSet) await replicaSet.stop();
}
