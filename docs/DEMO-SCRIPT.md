# DishDash 10-minute demonstration

## Before the demonstration

- Start MongoDB Atlas or the optional local replica set.
- From the repository root run `npm run dev`.
- In another terminal run `npm run seed` once for a fresh database.
- Use four separate browser profiles/windows so each role has an independent
  login session.
- The seeded accounts share `DishDashDemo2026!`; keep these demo accounts in
  development only.

## Walkthrough

| Time | Presenter action | What to explain / expected result |
| --- | --- | --- |
| 0:00–0:45 | Open the buyer browser and sign in as `buyer@dishdash.demo`. | Introduce DishDash as a Nigerian-food marketplace. Point out the logo, responsive navigation, NGN pricing, and seeded menu. |
| 0:45–1:45 | Search for “jollof”, open the result if needed, add it to cart, and open the cart. | Demonstrate catalog search, available stock, product image placeholder/uploaded image, cart quantity and total. |
| 1:45–2:30 | Click Checkout, then **Simulate success** on the mock payment page. | Describe the transactional checkout pipeline: current price/stock check, conditional stock decrement, order/payment creation, and idempotency key. |
| 2:30–3:30 | Keep buyer order details open. In the vendor browser sign in as `vendor@dishdash.demo`, then open Incoming Orders and mark the paid order Shipped. | Point to the order status history and explain that only the owning vendor can mark a paid order Shipped. |
| 3:30–4:30 | In the courier browser sign in as `courier@dishdash.demo`, accept the available delivery, then mark it Delivered. | Return to buyer browser and show live status/timeline updates from Socket.IO without refresh. Mention JWT-authenticated rooms and atomic courier assignment. |
| 4:30–5:15 | Back in buyer order details, click Download receipt. | Show the generated PDF with item lines, order/payment reference, NGN totals, fee, and logo. |
| 5:15–6:00 | In buyer browser, submit a short problem report for the delivered order. | Explain buyer-owned dispute validation and admin review. |
| 6:00–7:15 | In admin browser sign in as `admin@dishdash.demo`; open Dashboard, Orders, Users, and Disputes. Mark the new dispute Under review. | Show status/user counts, volume, delivery count, fee summaries, paginated admin views, and dispute workflow. |
| 7:15–8:15 | Refund the dispute from the admin view. | Explain provider refund abstraction and ledger reversal inside a MongoDB transaction. |
| 8:15–9:00 | Open Ledger and show the Balanced badge and matching debit/credit totals. | Explain double-entry: original entries plus reversed entries keep the ledger balanced. Repeating the refund does not write another reversal. |
| 9:00–10:00 | Show the vendor product editor; optionally upload a JPG/PNG/WebP image. Log out from each role. | Demonstrate upload type/size limits, vendor ownership, mobile navigation, and role-specific logout/navigation. |

## Presenter notes

- Keep `PAYMENT_PROVIDER=mock` for an offline-safe demo. Mock payment simulation
  is development-only and is not the production webhook flow.
- If no local sample photos are in `server/seed-images`, the seeded catalog
  uses a placeholder URL. Product image uploads in development are stored under
  ignored `server/uploads/`.
- If time is short, skip the optional product upload and use the seeded menu.
- The dashboard is a project MVP, not a production SLA measurement. The load
  runner uses an isolated local replica set; report its environment and results
  honestly.
