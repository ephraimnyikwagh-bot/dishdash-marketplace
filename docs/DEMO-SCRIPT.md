# Carted 10-minute demonstration

## Before the demonstration

- Start MongoDB Atlas or the optional local replica set.
- From the repository root run `npm run dev`.
- In another terminal run `npm run seed` once for a fresh database.
- Use separate browser profiles for the buyer, seller, courier, and admin roles.
- Demo accounts share `CartedDemo2026!`; keep them in a demo environment only.

| Time | Presenter action | What to explain / expected result |
| --- | --- | --- |
| 0:00–0:45 | Open Carted and review the landing page. | Introduce the Nigerian marketplace, responsive navigation, category links, featured listings, and safety information. |
| 0:45–1:45 | Sign in as `buyer@carted.demo`, browse by category and search for an item. Open its detail page, add it to the cart, and choose delivery or pickup. | Demonstrate listing filters, seller profile, available quantity, image gallery, cart totals, and fulfilment choice. |
| 1:45–2:30 | Click Checkout, then **Simulate success** on the mock payment page. | Explain price/quantity checks, atomic quantity reservation, order/payment creation, and idempotency. |
| 2:30–3:30 | Sign in as `vendor@carted.demo`, open Incoming Orders, and set the paid order to Shipped or Ready for pickup. | Only the seller owning the paid order can choose its next fulfilment state. |
| 3:30–4:30 | For delivery, sign in as `courier@carted.demo`, accept and deliver it, then confirm receipt as the buyer. For pickup, click **Confirm received** after the seller marks it ready. | Show secure escrow status, immediate release on buyer confirmation, and the three-day delivery fallback. |
| 4:30–5:15 | Download the buyer's receipt. | Show the Carted logo, listing lines, order/payment reference, and NGN totals. |
| 5:15–6:00 | Submit a short problem report from the buyer order. | Explain buyer ownership checks and admin dispute review. |
| 6:00–7:15 | Sign in as `admin@carted.demo`; review Dashboard, Orders, Users, Disputes, Ledger, and Payouts. | Show escrow integrity, disputed holds, and simulated seller payouts. |
| 7:15–8:15 | Resolve/refund the dispute from the admin view. | Explain transactional ledger reversal and idempotency. |
| 8:15–9:00 | Open a completed buyer order and submit a review; sign in as the seller to reply. | Show the verified purchase badge and aggregate seller rating. |
| 9:00–10:00 | Open the seller wallet, then the admin review moderation page; finish on the glass-styled landing page. | Pending, Available, and Paid out balances are distinct; hidden reviews no longer affect ratings. |

## Presenter notes

- Use `PAYMENT_PROVIDER=mock` for an offline demo. Production mock simulation
  requires both server `DEMO_MODE=true` and client `VITE_DEMO_MODE=true`.
- Seed listings use placeholder images unless local sample images are available.
- Seed data includes example held, released, and refunded orders and verified
  seller reviews. Auto-release uses a timer while the API is awake and a lazy
  check on reads; Render free instances can sleep, delaying a due release until
  the next order or wallet read after wake-up.
- The dashboard is a project MVP, not a production SLA measurement. Do not
  present local benchmark results as a production capacity guarantee.
