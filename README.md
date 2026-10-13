# DishDash

DishDash is an on-demand food delivery marketplace. This repository currently
contains the Phase 1 foundation, Phase 2 authentication/RBAC, Phase 3
catalog/inventory/cart APIs, Phase 4 transactional checkout and sandbox
payments, and a React client for buyer/vendor flows.

## Prerequisites

- Node.js 20 or newer
- MongoDB Atlas (replica-set cluster) **or** Docker Desktop for optional local
  MongoDB

Docker is optional. The server reads `MONGODB_URI` from `server/.env` and can
connect directly to an Atlas replica set. MongoDB transactions require a
replica-set or sharded deployment; the server checks transaction capability at
startup and logs a warning when it is unavailable or cannot be verified.

## Configure and run

1. Create `server/.env` using `.env.example` as a guide. Set `MONGODB_URI` to
   your Atlas connection string, `JWT_SECRET` to a random secret of at least 32
   characters, and `ADMIN_REGISTRATION_KEY` to a separate random secret. For
   payments, set Stripe test-mode `STRIPE_SECRET_KEY` and
   `STRIPE_WEBHOOK_SECRET`.
2. In Atlas, allow your development IP and ensure the database user has the
   required read/write permissions.
3. Start the API:

   ```powershell
   Set-Location server
   npm.cmd install
   npm.cmd run dev
   ```

4. Create `client/.env` from `client/.env.example`. Set `VITE_API_URL` to the
   API base URL, normally `http://localhost:4000/api`, and set
   `VITE_STRIPE_PUBLISHABLE_KEY` to the Stripe test-mode publishable key. The
   server's `CLIENT_ORIGIN` should include `http://localhost:5173`.
5. In a second terminal, start the client:

   ```powershell
   Set-Location client
   npm.cmd install
   npm.cmd run dev
   ```

   The buyer and vendor UI runs at `http://localhost:5173`; the API health check is
   `http://localhost:4000/api/health`.

### Optional local MongoDB

For local development instead of Atlas, run the single-node replica set:

```powershell
docker compose up -d mongo
```

Use `MONGODB_URI=mongodb://localhost:27017/food_marketplace?replicaSet=rs0`
in `server/.env`. Shut it down with `docker compose down`; add `-v` only if you
intend to remove its persisted local database volume.

## Environment variables

| Variable                      | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `NODE_ENV`                    | Runtime environment                                     |
| `PORT`                        | API port (default `4000`)                               |
| `CLIENT_ORIGIN`               | Comma-separated allowed browser origins                 |
| `MONGODB_URI`                 | MongoDB Atlas or local replica-set connection string    |
| `JWT_SECRET`                  | Random signing key, at least 32 characters              |
| `JWT_EXPIRES_IN`              | JWT lifetime, for example `1d`                          |
| `ADMIN_REGISTRATION_KEY`      | Secret required to register an admin account            |
| `STRIPE_SECRET_KEY`           | Stripe test-mode secret key (`sk_test_...`)             |
| `STRIPE_WEBHOOK_SECRET`       | Signing secret from Stripe CLI or test webhook endpoint |
| `PLATFORM_FEE_BPS`            | Platform fee in basis points (default `1000`, i.e. 10%) |
| `VITE_API_URL`                | Client API base URL in `client/.env`                    |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe test-mode publishable key in `client/.env`       |

Never commit `.env` files or put payment card details in application storage.

## Authentication API (Phase 2)

All routes are prefixed with `/api`.

| Method | Endpoint         | Access               | Description                                            |
| ------ | ---------------- | -------------------- | ------------------------------------------------------ |
| `POST` | `/auth/register` | Public, rate limited | Register a buyer, vendor, courier, or authorized admin |
| `POST` | `/auth/login`    | Public, rate limited | Verify credentials and receive a JWT                   |
| `GET`  | `/auth/me`       | Bearer JWT           | Return the authenticated user's public profile         |
| `GET`  | `/health`        | Public               | API health check                                       |

Registration accepts `name`, `email`, `password`, and optional `role` (defaults
to `buyer`). Registering as `admin` additionally requires
`adminRegistrationKey` matching the server's `ADMIN_REGISTRATION_KEY`. Passwords
are bcrypt-hashed; API responses never return password hashes. Login returns
the JWT as `token`. Send protected requests with
`Authorization: Bearer <token>`.

Role authorization middleware is available for subsequent protected API
routes: `requireAuth` authenticates the bearer token and `allowRoles("vendor")`
(or another role list) restricts access. Authentication and authorization
failures return HTTP 401 and 403 respectively.

## Catalog and cart API (Phase 3)

The client signs in buyers and vendors and routes each role to its workspace.
Buyers can browse/search the catalog, add products to their cart, edit
quantities, remove items, and pay through the Stripe test-mode Payment Element.
Vendors can create, update, and remove products and manage stock.

| Method   | Endpoint                           | Access           | Description                                                      |
| -------- | ---------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `GET`    | `/products?q=wrap&page=1&limit=12` | Authenticated    | Search and paginate active products                              |
| `GET`    | `/products/:productId`             | Authenticated    | View an active product                                           |
| `GET`    | `/products/mine`                   | Vendor           | List own active products                                         |
| `POST`   | `/products`                        | Vendor           | Create a menu product                                            |
| `PATCH`  | `/products/:productId`             | Owning vendor    | Update product fields and stock                                  |
| `DELETE` | `/products/:productId`             | Owning vendor    | Remove product from the catalog                                  |
| `GET`    | `/cart`                            | Buyer            | Read cart and total in cents                                     |
| `POST`   | `/cart/items`                      | Buyer            | Add product with `productId` and `quantity`                      |
| `PATCH`  | `/cart/items/:productId`           | Buyer            | Set item quantity                                                |
| `DELETE` | `/cart/items/:productId`           | Buyer            | Remove item                                                      |
| `POST`   | `/checkout`                        | Buyer            | Create an idempotent transaction-backed order and payment intent |
| `POST`   | `/webhooks/stripe`                 | Stripe signature | Confirm payment, balance ledger, or restore stock on failure     |

Product prices use integer cents, and stock/quantities are whole numbers.
Catalog pagination accepts `page` and `limit` (maximum 50); `q` searches product
names. The API base URL for the Vite app is configured with `VITE_API_URL` in
`client/.env`.

## Checkout and sandbox payments (Phase 4)

`POST /api/checkout` is buyer-only. Provide a unique `Idempotency-Key` request
header for a cart checkout. The server validates that products are active and
from one vendor, then reserves stock, snapshots order items, creates the pending
order/payment record, and clears the cart in one MongoDB transaction. Only after
that transaction commits does it create a Stripe PaymentIntent with a matching
Stripe idempotency key and attach its ID to the payment record. If Stripe is
temporarily unavailable, retrying the same checkout key resumes the committed
order without decrementing stock a second time. The response contains an order,
payment summary, and Stripe `clientSecret`; card data is entered through Stripe
Elements and is never handled or stored by the application.

After the buyer confirms the sandbox payment, Stripe sends the
`payment_intent.succeeded` event to `POST /api/webhooks/stripe`. A valid
signature is required. The handler idempotently marks the order Paid and writes
balanced ledger lines in one transaction: buyer-clearing debit, vendor-payable
credit, and platform-revenue credit when the fee is nonzero. A
`payment_intent.payment_failed` event records the failed attempt but keeps the
PaymentIntent and stock reservation retryable. When Stripe reports
`payment_intent.canceled`, the server marks the order Failed and restores its
reserved stock. Never expose `STRIPE_SECRET_KEY` or
`STRIPE_WEBHOOK_SECRET` to the browser.

For local Stripe CLI testing, start the server and run:

```powershell
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Copy the CLI's `whsec_...` signing secret into `server/.env`, then restart the
API. Register/login as a buyer, add an in-stock product to the cart, and choose
**Continue to payment**. Use a Stripe test card such as `4242 4242 4242 4242`,
any future expiry, any CVC, and any postal code. The order stays Pending until
the signed success webhook arrives. Stripe CLI can also trigger failure events
for testing. The browser persists only the checkout idempotency key to resume
pending checkout; payment card data is handled directly by Stripe Elements.

## Checks

```powershell
Set-Location server
npm.cmd test
npm.cmd run lint

Set-Location ..\client
npm.cmd run lint
npm.cmd run build
```

Backend tests include auth/RBAC, catalog/cart, and checkout/payment/ledger flows.
Checkout tests run against a disposable MongoDB replica set and use a fake
gateway; they do not contact Stripe. Real webhook testing requires Stripe CLI
and test-mode keys as described above.
