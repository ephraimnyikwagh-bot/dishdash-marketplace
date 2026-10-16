# Carted marketplace traceability

This matrix describes the current marketplace implementation and its checks.
“Partial” identifies demo-only or operational limits rather than a production
guarantee.

| Requirement | Implementation | Verification / caveat |
| --- | --- | --- |
| Carted branding, transparent light/dark logo variants, glass UI, public landing page, and metadata | `client/public/logo-light.png`, `logo-dark.png`, `client/src/pages/LandingPage.jsx`, Tailwind glass tokens | `client/scripts/generate-logo-variants.mjs`; Vite build |
| Public featured listings with private seller data omitted | `GET /api/public/featured` | `server/src/routes/public.test.js`; rate limited and capped at eight |
| Public browse, filters, detail pages, and seller profiles | `GET /api/public/listings`, `/api/public/listings/:listingId`, `/api/public/sellers/:sellerId` | Public route tests verify search filters and no seller email exposure |
| Buyer, seller, courier, and admin authentication | `/api/auth/register`, `/api/auth/login`, `/api/auth/me`; role remains `vendor` internally | Auth, catalog, checkout integration tests; admin registration requires `ADMIN_REGISTRATION_KEY` |
| Seller listing creation, ownership, quantity, condition, location, and photos | `/api/products`, `/api/products/mine`, `/api/products/:productId`, `/api/products/:productId/images` | `server/src/routes/catalog.test.js`, `server/src/routes/public.test.js`; max five JPG/PNG/WebP images at 2 MB each |
| Eight marketplace categories and Nigerian state/city fields | `server/src/models/Product.js`; listing editor and browse filters | Schema validation and public filter integration tests |
| Search, category/price/condition/location filters, sorting, and pagination | Public `/api/public/listings`; seller-authenticated `/api/products` | Public listing route tests |
| Cart quantity limits and atomic reservation | `/api/cart`; transactional `server/src/services/checkout.js` | Cart and checkout tests; cart maximum is 99 per listing |
| Delivery and pickup order state machines | `/api/checkout`, `/api/orders/:orderId/status`, `/api/courier/*` | Checkout lifecycle tests cover role ownership, pickup readiness, buyer receipt confirmation, and courier delivery |
| Mock and Flutterwave TEST payments | `server/src/services/payments/`; `/api/payments/*` | Integration tests; hosted payment depends on provider verification |
| Balanced ledger, disputes, and downloadable Carted PDF receipts | `/api/ledger/*`, `/api/disputes/*`, `/api/orders/:orderId/receipt` | Checkout integration tests; receipts are stored in MongoDB |
| Escrow holds, completion release, buyer confirmation, lazy/timer auto-release, and frozen disputes | `server/src/services/escrow.js`; `/api/orders/:orderId/confirm-received` | MongoDB transactions; Render free instances may sleep, so due releases also run lazily on order/wallet reads |
| Integer-kobo seller wallet and simulated payouts | `/api/ledger/wallet`, `/api/ledger/wallet/payouts`, `/api/ledger/admin/payouts` | Payout ledger writes are transactional and idempotent; no real funds are transferred |
| Verified buyer reviews, one seller reply, reports, moderation, and aggregate ratings | `/api/reviews/*`; public seller and listing endpoints | Hidden reviews stop counting; aggregates update within MongoDB transactions |
| Demo identities and repeatable marketplace seed | `server/src/scripts/seed.js`; gated admin demo-seed endpoint | Seed creates 24 listings across three sellers and removes legacy demo accounts/data; production requires `DEMO_MODE=true` |
| MongoDB transactions and no overselling | Checkout, escrow, refunds, reviews, payout posting, and seed financial records use MongoDB sessions | Tests use a replica set; deployment database must support transactions |
| Deployment security and secret hygiene | `render.yaml`, `docs/DEPLOYMENT.md`, `.gitignore` | Keep `.env` files untracked; no local benchmark is a hosted capacity guarantee |
