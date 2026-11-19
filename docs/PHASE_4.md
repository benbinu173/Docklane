# Phase 4: Reservations, orders, and concurrency proof

Status: complete and verified on 18 November 2026.

Docklane now connects the customer collection to a saved bag, delivery details, price review, transactional stock reservations, and order history. Staff can inspect the same orders and cancel eligible unpaid orders. No payment is charged in this phase.

## Open the checkout flow

Sign in as a Customer, open **Collection**, choose a product, and select **Add to bag**. **My bag** keeps SKU/quantity picks for that identity in this browser. Continue to delivery, enter an Indian address/PIN code, review the server-priced total, and select **Reserve order**.

Routes: `/account/cart`, `/account/checkout`, and `/account/orders/:identifier`. Staff orders remain at `/workspace/orders` and `/workspace/orders/:identifier`. The order list accepts combined search, status, warehouse, and pagination parameters in its URL/API query. Customer queries always include ownership checks.

Version 1 accepts up to 20 products and 99 units per product. Duplicate SKU lines are combined before checking quantities and prices. All amounts use integer INR paise, and delivery is currently free. These are explicit first-release limits.

## Reservation transaction

Checkout accepts SKU/quantity lines, an address, the reviewed-price fingerprint, and a retry key. Client-supplied prices/totals are rejected. Quotes are read-only repeatable-read snapshots; they do not hold stock.

Creation locks the current actor, an actor/operation/key advisory lock, products in stable SKU order, the selected warehouse, and its balance rows in stable SKU order. Product/site archives and physical stock corrections use compatible locks. Current roles, product availability, server prices, and stock are checked again inside the transaction.

A warehouse qualifies only if it can fulfill every line. Selection uses ascending priority and warehouse ID. The service considers at most 16 eligible candidates in one attempt, revalidates after waiting for locks, and retries candidate selection when contention exhausts those candidates. Deadlock/serialization retries are bounded at three attempts; an exhausted retry returns a recoverable busy response. No transaction leaves a partially reserved bag.

The order, price/name/image/address snapshots, reservations, reserved-balance increments, versioned `RESERVE` movements, audit event, expiry outbox event, and completed idempotency record commit together. Physical on-hand quantities do not change. An injected audit failure rolls back every business write.

The deadline uses PostgreSQL wall time after balance locks are acquired, plus 30 minutes. Order numbers come from a database sequence; rollback can leave harmless numbering gaps. The migration adds cancellation details and a reservation balance/status index, and initializes the sequence beyond existing numeric order identifiers.

## Retry and cancellation behavior

Creation keys are scoped to the actor and operation. The fingerprint covers normalized lines, the address, and reviewed prices. Same-key concurrent submissions create one order. Reusing a key for another payload fails. Successful replays return the same order in its current authoritative state, including when it has since been cancelled.

Before sending creation, the browser saves the exact request in identity-scoped session storage. A lost response or recoverable server failure retains that payload/key and shows **Retry same reservation**, including after reload. A retry cannot reserve the same bag again. Successful creation removes the submitted picks and opens the saved order; later additions remain in the bag. A price change requires another deliberate submission after the updated review; it never auto-reserves at the new price. Bag state stays scoped to the identity without remounting sign-in forms when sessions change.

An unpaid order with held reservations can be cancelled by its owner or authorized staff. Cancellation locks the order before its products/site/balances. It releases each held quantity, advances balance versions, records `RELEASE` movements and an audit event, and saves the command outcome atomically. Repeated/concurrent cancellations release stock once. A failed cancellation audit leaves the original order and hold intact. Paid/shipped order cancellation remains with payment/fulfillment work.

## Expiry boundary

At the Phase 4 delivery, creation wrote an `ORDER_RESERVATION_EXPIRY` outbox event with its database deadline in the same transaction. **Automatic expiry was not running in Phase 4.** Held quantities remained reserved until explicit cancellation, including after the recorded deadline. [Phase 5](PHASE_5.md) now adds the worker, durable dispatch, expiry sweeps, and payment/expiry serialization. UI payment and fulfillment states remain separate.

Checkout does not call Stripe, capture money, confirm payment, pack/ship orders, or issue refunds. Existing seeded paid/shipped records remain development examples.

## API and commands

- `POST /api/v1/checkout/quote`: current prices and a qualifying site, with availability.
- `POST /api/v1/orders`: retry-safe creation and stock hold; Customer only.
- `POST /api/v1/orders/:identifier/cancellations`: owner/staff unpaid cancellation.
- `GET /api/v1/orders` and `GET /api/v1/orders/:identifier`: persisted lists/details, reservations, deadlines, and cancellation results.

```sh
npm run db:migrate
npm run build
npm run test:unit
npm run test:integration
npm run prove:concurrency
npm run test:auth -- --phase4
npm run test:auth -- --all
```

The checkout migration was tested on the dedicated loopback `docklane_test` database and applied to the existing isolated Neon development branch. The parent branch remains untouched. `prove:concurrency` uses only the guarded local test database and creates its own business/site/product/accounts; it does not reset seeded development data.

## Verification

The repeatable concurrency proof passed: 10 available units and 50 simultaneous requests from distinct customers produced exactly 10 orders/holds and 40 insufficient-stock responses, with zero other responses. The measured request batch took 1184 ms. The command writes environment, timing, and ledger results to [the concurrency report](CONCURRENCY_PROOF.md). Its synthetic identity verifier replaces cloud Auth while production routes, database roles, and reservation services remain active. No expiry worker runs in that harness; elapsed time is a local observation, not a hosted performance benchmark.

Eleven PostgreSQL checkout checks cover the 50-request case, normalized/concurrent same-key retries and conflicts, single-site multi-item eligibility, contention fallback, server prices and snapshots, invalid/archived inputs, full creation rollback, database deadlines/outbox work, cancellation rollback/retry, repeated releases, stock-adjustment races, and ownership/role restrictions. Coverage includes successful two-SKU order creation and cancellation that releases both lines, as well as all-or-nothing failure cases.

The four live browser checks cover saved/reloaded bags, complete checkout and cancellation, staff visibility, a lost creation response followed by reload/retry, preservation of later bag additions, changed-price review, unavailable quantities, and responsive accessibility. They use synthetic products/sites, cancel holds, clear fixture stock, and archive records through the API. Credential traces/failure screenshots are disabled, and the guarded runner suppresses automatic failure snapshots and redacts output/text diagnostics.

All 78 distinct tests passed: seven domain, 42 PostgreSQL/API, and 29 production browser checks (seven identity, six Phase 3, four Phase 4, and 12 public prototype). The full browser run completed in 10.4 minutes using the compiled API and production frontend. Accessibility and layout checks passed at 390, 768, 1366, and 1440 px; desktop and mobile previews were visually reviewed. Formatting, lint, type checking, and production builds passed. A development sign-in smoke check also passed with zero page errors.

Final read-only reconciliation of the isolated Neon development branch found zero movement-ledger mismatches and zero reservation-total mismatches. All verification fixture holds were released, and seeded inventory was preserved. The existing dependency limitation remains documented in [Phase 2](PHASE_2.md#dependency-review).

## Reviewed previews

| View             | Desktop, 1366 px                             | Mobile, 390 px                             |
| ---------------- | -------------------------------------------- | ------------------------------------------ |
| My bag           | [Desktop](previews/phase4-bag-1366.png)      | [Mobile](previews/phase4-bag-390.png)      |
| Delivery details | [Desktop](previews/phase4-delivery-1366.png) | [Mobile](previews/phase4-delivery-390.png) |
| Price review     | [Desktop](previews/phase4-review-1366.png)   | [Mobile](previews/phase4-review-390.png)   |
| Reserved order   | [Desktop](previews/phase4-order-1366.png)    | [Mobile](previews/phase4-order-390.png)    |

The order previews intentionally capture the held state; that verification order was subsequently cancelled during cleanup.
