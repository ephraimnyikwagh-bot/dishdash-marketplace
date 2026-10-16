# DishDash

DishDash is an on-demand food delivery marketplace MVP. It currently includes
authentication/RBAC, vendor catalog management, buyer carts, transaction-backed
checkout, mock and Flutterwave TEST payment providers, an idempotent payment
webhook, a double-entry ledger, order views, and a React SPA for buyers and
vendors, live courier tracking, PDF receipts, and admin reporting and dispute
management.

## Requirements

- Node.js 20 or newer
- MongoDB Atlas replica-set cluster, or Docker Desktop for optional local MongoDB

Docker is optional. The server reads `MONGODB_URI` from `server/.env` and can
connect directly to Atlas. Multi-document transactions require a replica-set or
sharded MongoDB deployment; startup logs the connection and warns if transaction
support cannot be verified.

## Setup and run

1. Copy `.env.example` to `server/.env`. Set `MONGODB_URI`, a random
   `JWT_SECRET` of at least 32 characters, and a separate
   `ADMIN_REGISTRATION_KEY`. Defaults to the offline mock payment provider.
2. In Atlas, allow your development IP and ensure the database user has the
   required read/write permissions.
3. Install and start the API:

   ```powershell
   Set-Location server
   npm.cmd install
   npm.cmd run dev
   ```

4. Copy `client/.env.example` to `client/.env`. Set `VITE_API_URL` to
   `http://localhost:4000/api`; ensure `CLIENT_ORIGIN` in `server/.env` includes
   `http://localhost:5173`.
5. Install and start the SPA in a second terminal:

   ```powershell
   Set-Location client
   npm.cmd install
   npm.cmd run dev
   ```

   Open `http://localhost:5173`. The API health endpoint is
   `http://localhost:4000/api/health`.

## Demo data

After configuring `server/.env` and starting MongoDB, seed the demo accounts
and menu from a PowerShell terminal:

```powershell
Set-Location server
npm.cmd run seed
```

The command is safe to repeat: it updates the four demo users and upserts the
ten menu items without creating duplicates. It refuses to run when
`NODE_ENV=production`.

All demo accounts share the password `DishDashDemo2026!`:

| Role | Email |
| --- | --- |
| Buyer | `buyer@dishdash.demo` |
| Vendor | `vendor@dishdash.demo` |
| Courier | `courier@dishdash.demo` |
| Admin | `admin@dishdash.demo` |

### Optional local MongoDB replica set

Docker Compose is only an optional local convenience:

```powershell
docker compose up -d mongo
```

Use `MONGODB_URI=mongodb://localhost:27017/food_marketplace?replicaSet=rs0`
in `server/.env`. Stop the service with `docker compose down`; add `-v` only if
you intend to remove the persisted local database volume.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime environment; mock simulations and Flutterwave are disabled in production |
| `PORT` | API port (default `4000`) |
| `CLIENT_ORIGIN` | Comma-separated allowed browser origins |
| `MONGODB_URI` | MongoDB Atlas or local replica-set connection string |
| `JWT_SECRET` | Random JWT signing secret, at least 32 characters |
| `JWT_EXPIRES_IN` | JWT lifetime (default `7d`) |
| `ADMIN_REGISTRATION_KEY` | Separate secret required for admin registration |
| `PAYMENT_PROVIDER` | `mock` (default) or `flutterwave` |
| `FLW_SECRET_KEY` | Flutterwave TEST secret key; required only for Flutterwave |
| `FLW_PUBLIC_KEY` | Flutterwave TEST public key; required only for Flutterwave |
| `FLW_WEBHOOK_HASH` | Flutterwave webhook verification hash |
| `FLW_BASE_URL` | Optional; if set, must be `https://api.flutterwave.com/v3` |
| `FLW_REDIRECT_URL` | Optional hosted-payment redirect destination; defaults to the client return page |
| `PLATFORM_FEE_BPS` | Platform fee in basis points (default `1000`, 10%) |
| `VITE_API_URL` | Client API base URL, normally `http://localhost:4000/api` |

Never commit any `.env` file. Card details are collected only by Flutterwave's
hosted checkout and are never stored by DishDash.

## Authentication and roles

All API routes below are prefixed with `/api`.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Public, rate limited | Register buyer/vendor/courier, or admin with the registration key |
| `POST` | `/auth/login` | Public, rate limited | Authenticate and receive a JWT |
| `GET` | `/auth/me` | Authenticated | Return the signed-in user's public profile |
| `GET` | `/health` | Public | API health check |

Registration takes `name`, `email`, `password`, and optional `role` (defaults
to `buyer`). Admin registration also requires `adminRegistrationKey`. Passwords
are bcrypt-hashed. Send `Authorization: Bearer <token>` on protected requests.

## Catalog, cart, and orders

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/products?q=wrap&page=1&limit=12` | Authenticated | Search and paginate active products |
| `GET` | `/products/:productId` | Authenticated | Read an active product |
| `GET` | `/products/mine` | Vendor | List own products |
| `POST` | `/products` | Vendor | Create a product |
| `PATCH` | `/products/:productId` | Owning vendor | Update product and inventory |
| `DELETE` | `/products/:productId` | Owning vendor | Deactivate/remove a product |
| `GET` | `/cart` | Buyer | Read cart and total in integer cents |
| `POST` | `/cart/items` | Buyer | Add `{ "productId": "...", "quantity": 1 }` |
| `PATCH` | `/cart/items/:productId` | Buyer | Set quantity |
| `DELETE` | `/cart/items/:productId` | Buyer | Remove a cart item |
| `POST` | `/checkout` | Buyer | Reserve inventory and create an order/payment |
| `GET` | `/orders?page=1&limit=10` | Buyer/vendor/admin | List own, related, or all orders, respectively |
| `GET` | `/orders/:orderId` | Buyer/vendor/admin | Read an accessible order and its items |

Product prices and all order/ledger money values are integer cents. Product and
order listing endpoints are paginated. Checkout currently requires all items
in the cart to belong to the same vendor.

## Mock checkout (default, no keys)

With `PAYMENT_PROVIDER=mock` (or unset), the browser flow is:

1. Log in as a buyer, add a product to the cart, and click **Checkout**.
2. On the payment page, click **Simulate success** or **Simulate failure**.
3. Check the resulting order under **Orders**.

Simulation is development-only; the API does not expose it when
`NODE_ENV=production`. No card details are requested or stored. On success, the
payment and order are marked paid and balanced ledger entries are written in a
MongoDB transaction. On failure/expiry, the order is marked failed and reserved
stock is restored.

## Flutterwave TEST checkout

Set `PAYMENT_PROVIDER=flutterwave` and provide only Flutterwave TEST credentials
in `server/.env`:

```text
FLW_SECRET_KEY=FLWSECK_TEST-...
FLW_PUBLIC_KEY=FLWPUBK_TEST-...
FLW_WEBHOOK_HASH=...
FLW_BASE_URL=https://api.flutterwave.com/v3
FLW_REDIRECT_URL=http://localhost:5173/payment/return
```

Restart the API, then use the same buyer checkout flow. The payment page sends
the buyer to Flutterwave's hosted test checkout. The API verifies the
`verif-hash` webhook header and independently verifies the transaction amount,
currency, and reference with Flutterwave before updating the order or ledger.
Flutterwave mode is restricted to non-production and rejects live-mode keys.
Do not expose any `FLW_*` secret to the client.

## Checkout and ledger guarantees

`POST /api/checkout` requires an `Idempotency-Key` header (8-128 characters).
The key is scoped to the buyer. The server validates current product state and
price, conditionally decrements stock within a MongoDB session transaction,
creates the order/items/payment intent, and clears the cart. An unavailable
payment provider aborts the database transaction. A unique order key prevents
retries from reserving inventory twice; providers receive a stable idempotency
reference.

Payment notifications are processed at `POST /api/payments/webhook`. Duplicate
event IDs are ignored, and terminal order/payment checks prevent duplicate
ledger writes. Successful payment creates balanced debit/credit lines for buyer
clearing, vendor payable, and (when nonzero) platform revenue. All ledger
entries are integer cents.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/checkout` | Buyer | Start checkout; requires `Idempotency-Key` |
| `GET` | `/payments/:paymentId` | Owning buyer | Read payment status/details |
| `POST` | `/payments/:paymentId/simulate` | Owning buyer, development mock only | Simulate `succeeded`, `failed`, or `expired` |
| `POST` | `/payments/webhook` | Flutterwave signature | Verify Flutterwave event and process payment |
| `GET` | `/ledger/integrity` | Admin | Check debit/credit totals per currency |

The mock simulation route is for local demos, not a production webhook
substitute. Flutterwave's webhook is the externally verified payment flow.

## Order lifecycle and live updates (Phase 5)

Order statuses are `Pending`, `Paid`, `Shipped`, `Delivered`, `Failed`, and
`Cancelled`. The supported fulfillment transitions are `Paid` to `Shipped` by
the owning vendor, then `Shipped` to `Delivered` by the assigned courier. A
buyer may cancel only a `Pending` order. Invalid transitions return HTTP 409
with the current and requested states; requests by the wrong role are rejected.
Every status transition appends the status, actor/role, and timestamp to the
order's `statusHistory`.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `PATCH` | `/orders/:orderId/status` | Buyer/vendor | Buyer cancels a pending order; owning vendor marks paid order shipped |
| `GET` | `/courier/available?page=1&limit=10` | Courier | List unassigned shipped orders |
| `POST` | `/courier/:orderId/accept` | Courier | Atomically accept an available delivery |
| `GET` | `/courier/deliveries?page=1&limit=10` | Courier | List assigned and completed deliveries |
| `POST` | `/courier/:orderId/delivered` | Assigned courier | Mark an accepted order delivered |

The API Socket.IO server authenticates connections using the same JWT as REST
requests. Clients join their own `user:<userId>` room automatically and may
join an authorized `order:<orderId>` room using `order:join`. Status and
assignment updates are emitted as `order:updated` to the buyer, vendor, and
assigned courier. The client provides a buyer order timeline, vendor
ship-ready action, courier dashboard, toast messages, and a recent-updates bell.

To demo with three browser windows, sign in separately as
`buyer@dishdash.demo`, `vendor@dishdash.demo`, and `courier@dishdash.demo`
(shared password `DishDashDemo2026!`). Pay for a buyer order, open its details
in the buyer window, mark it shipped from the vendor's Incoming orders, then
accept and deliver it in the courier dashboard. The buyer timeline and all
involved notification bells update live.

## Receipts, admin, and disputes (Phase 6)

Every successful payment creates a reusable PDF receipt. Downloading a receipt
requires an authenticated buyer who owns the order, its vendor, or an admin.
The PDF contains the order/payment reference, buyer and vendor, items,
quantities, integer-cent prices formatted as NGN, subtotal, fee, and total.
The DishDash logo is included when `client/public/logo.png` is available.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/orders/:orderId/receipt` | Owning buyer, involved vendor, admin | Download the generated PDF receipt |
| `POST` | `/disputes` | Buyer | Raise a dispute for an owned Paid or Delivered order with `{ "orderId": "...", "reason": "..." }` |
| `GET` | `/disputes?page=1&limit=20` | Buyer/admin | List own disputes or all disputes |
| `PATCH` | `/disputes/:disputeId` | Admin | Set status to `Under review`, `Resolved`, or `Refunded` |
| `GET` | `/admin/dashboard` | Admin | Transaction volume, order statuses, user counts, deliveries, fee revenue for 7/30 days |
| `GET` | `/admin/orders?page=1&limit=20` | Admin | Paginated marketplace orders |
| `GET` | `/admin/users?page=1&limit=20` | Admin | Paginated user list |
| `GET` | `/ledger/entries?page=1&limit=25&from=2026-01-01&to=2026-12-31&orderId=...` | Admin | Filtered and paginated ledger audit |
| `GET` | `/ledger/integrity` | Admin | Debit/credit totals and balance by currency |

Failed or expired payments automatically open a system dispute for admin
review. Admin refunds call the configured payment provider and reverse every
original ledger line within a MongoDB transaction; a repeated refund request is
idempotent. The mock provider is intended for offline demos. Flutterwave mode
uses the TEST API and requires the verified provider transaction ID. The order
is marked `Refunded` after the refund and reversal are recorded.

### Phase 6 browser walkthrough

1. Run the API and client, then seed demo data if this is a fresh database.
2. Sign in as `buyer@dishdash.demo` / `DishDashDemo2026!`, add a dish, check out,
   and simulate payment success.
3. On the order page, download the receipt. Submit a report from the order page.
4. Sign in in a separate browser window as `admin@dishdash.demo` with the same
   password. Review Dashboard, Orders, Users, Ledger, and Disputes.
5. Select **Under review**, then **Refund** (or **Resolve**) for the buyer's
   dispute. Verify the order status and that the ledger integrity badge remains
   **Balanced**. A second refund request is safe and does not create duplicate
   ledger entries.

For tests, use `Set-Location server; npm.cmd test` (all backend integration
tests) and `npm.cmd run lint`. For the UI use `Set-Location client;
npm.cmd run lint` and `npm.cmd run build`. Integration tests launch a disposable
MongoDB replica set using `mongodb-memory-server`; if its binary is not cached,
the first run needs network access to download MongoDB.

## Tests, lint, and build

```powershell
Set-Location server
npm.cmd test
npm.cmd run lint

Set-Location ..\client
npm.cmd run lint
npm.cmd run build
```

Backend integration tests use a disposable MongoDB replica set and cover
authentication/RBAC, catalog/cart behavior, checkout success and rollback,
parallel last-item purchases, checkout idempotency, webhook idempotency, order
access control, ledger balancing, lifecycle permissions/transitions, parallel
courier acceptance, and authenticated Socket.IO event delivery. Run the
lifecycle, courier-race, and socket cases along with the other checkout tests
using:

```powershell
Set-Location server
npm.cmd test -- --runTestsByPath src/routes/checkout.test.js
```

Tests do not contact Flutterwave.
