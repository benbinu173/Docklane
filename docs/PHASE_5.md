# Phase 5: Test payments and reservation expiry

Status: complete on 18 November 2026. The local correctness suite, running worker, hosted Stripe sandbox purchase, signed webhook delivery, and full late-payment test refund are verified.

Docklane now has Stripe test checkout, signed webhook receipts, payment reconciliation, automatic reservation expiry, late-payment refunds, and a separate worker. The payment panel shows pending, failed, confirmed, expired, refund-pending, and refunded outcomes. Staff can inspect saved background tasks; Admins can request an audited retry after reviewing a failure.

## Run the application

`npm run dev` starts the API, frontend, and worker. `npm run dev:worker` starts the worker separately when the API and frontend are already running. After building, use `npm run start:worker`. The worker readiness endpoint is `http://127.0.0.1:4010/health/ready`.

Without Stripe credentials, the API and worker still run: the checkout control explains that test checkout awaits configuration, and the worker releases expired stock holds. Payment jobs remain saved until credentials are configured. Existing seeded payments remain labeled development examples and cannot start Stripe checkout.

Set all three variables together in the ignored `.env.local` file, then restart the API and worker:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CHECKOUT_RETURN_ORIGIN=http://127.0.0.1:5173
```

The return origin must exactly match an entry in `WEB_ORIGINS`. Live Stripe keys are rejected. Secret values and provider error payloads are not logged. The frontend receives no Stripe secret or publishable key; hosted checkout uses the server-created URL.

For local webhook delivery, use the [Stripe CLI](https://docs.stripe.com/cli/install) and run:

```sh
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.succeeded,payment_intent.payment_failed,refund.updated,refund.created,refund.failed --forward-to http://127.0.0.1:4000/api/v1/webhooks/stripe
```

Save that listener's signing secret as `STRIPE_WEBHOOK_SECRET`. A Dashboard destination has its own signing secret; do not mix it with the CLI secret. For a deployed destination, choose snapshot events and register the same endpoint over HTTPS.

Sign in as a Customer, reserve a new order, then choose **Continue to test payment**. Use [Stripe test cards](https://docs.stripe.com/testing), such as `4242 4242 4242 4242` with a future expiry and a valid test CVC. A failed attempt can resume the same checkout while its stock hold is active. Returning from Stripe does not confirm payment; the page waits for the saved result and provides a manual refresh action after bounded automatic refresh.

## Correctness and recovery

The API locks the actor and order and saves a single payment operation before contacting Stripe. Its immutable request contains order snapshots and one stable provider idempotency key. Concurrent submissions and lost responses recover the same session. Provider calls happen outside inventory transactions. Reconciliation can bind a provider session even if its initial API response was lost.

The webhook route verifies the signature against the raw request bytes before JSON parsing and application authentication. It rejects live-mode events, stores a minimal receipt containing the object identifier, and writes outbox work in the same transaction. The provider/event identifier is unique, so concurrent delivery creates one receipt and one task. Unsupported events are acknowledged without business mutations.

Processing retrieves current Stripe session and PaymentIntent state. The session, payment operation, order, business, INR currency, server amount, received amount, and test mode must match. Old failure or expiry notifications cannot regress a captured payment or completed refund. Only a verified paid session and successful PaymentIntent can confirm an order; URL parameters cannot do so.

Confirmation, cancellation, and expiry serialize on the same order lock. A timely confirmation changes held reservations to allocated; the reserved inventory quantity remains unchanged. Expiry releases each held quantity, records versioned movements, changes the order state, audits the outcome, and schedules checkout closure atomically. Physical on-hand stock is unchanged.

The 30-minute PostgreSQL deadline remains authoritative. Stripe requires a session expiry at least 30 minutes after provider session creation, so the stored provider expiry is 31 minutes beyond the stock deadline. The worker closes the session when the stock hold ends. If an outage or an in-flight capture permits a later payment, confirmation processed at or after the stock deadline never revives the order: stock stays released and the full test amount enters durable compensation work. This also covers payment processed after unpaid cancellation.

Compensation uses one saved refund operation and provider key. Lost responses are reconciled before another provider call; repeated workers cannot create multiple refunds. Completed refunds preserve the expired/cancelled order and released inventory. Because Stripe may prune idempotency keys after 24 hours, an ambiguous refund older than 23 hours is reconciled by provider reference/metadata; if no result can be found, it stops for review instead of risking another refund. Ordinary Admin partial/full refunds remain Phase 6.

## Worker behavior

PostgreSQL is the source of truth for scheduled work. BullMQ dispatches due outbox records with retries and exponential backoff. Processing claims a database lease; a worker crash leaves work reclaimable after 90 seconds. Database attempts have bounded exponential backoff and stop after eight failures or an association/reconciliation error. Staff can inspect the failure; only an Admin can save a reason and requeue it.

An independent database sweep runs every five seconds. It keeps releasing due holds while Redis reconnects, while dispatch is busy, and after a restart. Queue dispatch has a bounded wait and falls back to direct processing when Redis is unavailable. Queue names are scoped to the business and database environment, so development and isolated test workers cannot consume each other's tasks. Shutdown stops new work and waits for active database operations.

## API and interface

- `GET /api/v1/payments/configuration`: authenticated checkout availability.
- `POST /api/v1/orders/:id/payment-sessions`: owner/Customer Stripe checkout; accepts an empty body.
- `POST /api/v1/webhooks/stripe`: signed raw-body events, independent of a customer session.
- `GET /api/v1/operations/jobs`: staff task filters, pagination, counts, and safe failure details.
- `POST /api/v1/operations/jobs/:id/retries`: Admin recovery with an audited reason.
- Order details include confirmation/expiry timestamps and safe payment/refund status; checkout URLs are returned only by the owner's payment-start command.

The payment panel retains Docklane's sage, navy, and lime language, product totals, restrained motion, reduced-motion support, and mobile actions. Payment and fulfillment remain separate. The staff task view uses explicit state labels and a reviewed retry dialog.

## Verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:auth -- --phase5
npm run test:auth -- --all
```

Database tests use only the guarded local `docklane_test` database. They exercise production reservation/payment services with a deterministic provider stand-in; raw signature checks use the real Stripe SDK. Browser checks use real development identity and fixture orders, with intercepted payment outcomes to exercise UI states without charging or changing those fixture orders. Fixtures are cancelled, cleared, and archived after verification. Auth traces and automatic failure screenshots/snapshots remain disabled by the guarded runner.

All 99 distinct checks passed: seven domain, 60 PostgreSQL/API, and 32 production browser checks. The full browser run used the compiled API and production frontend and finished in 12.7 minutes. The browser total comprises seven identity, six Phase 3, four Phase 4, three Phase 5, and 12 public-prototype checks. Layout and accessibility checks covered 390, 768, 1366, and 1440 px widths. Formatting, lint, type checking, and production builds passed.

The 18 Phase 5 database checks include lost/concurrent checkout responses, raw signatures and deduplicated receipts, amount/currency/association validation, confirmation and cancellation/expiry races, single-release multi-item expiry, pending/failed/ambiguous refunds, old-key reconciliation, bounded retries, admin recovery, Redis outages, worker restart, audit rollback, and an expiry sweep continuing after one failed order. A separate real Redis/BullMQ transport smoke check completed a task with one claim.

A separate expiry smoke check used the running compiled worker on the existing isolated Neon development branch. It opened a synthetic balance with four physical units, reserved one, and shortened only that order's deadline while leaving its original outbox delivery in the future. The independent sweep expired the order, recorded exactly one release, preserved all four physical units, and reduced reserved stock to zero. Cleanup cleared the synthetic physical stock through an audited adjustment, archived its product/site, and deactivated the synthetic customer; the expired order and movement/audit history remain saved.

After configuring the user's personal Stripe sandbox, the API and worker were restarted with test credentials. Read-only Stripe API authentication and authenticated checkout availability passed. An isolated customer order created a real hosted test Checkout Session for INR 500; a second payment-start request returned that same session. Unpaid cancellation caused the running worker to close the session at Stripe. The actual signed `checkout.session.expired` webhook was received, saved, and processed through the worker. Exactly one stock release preserved all three fixture physical units before audited cleanup. No payment was attempted during this connection check.

The user completed the real hosted sandbox checkout for **DL-10023**, paying INR 1,499. Read-only verification retrieved a complete, paid Checkout Session and a successful PaymentIntent. The received amount, currency, order/business/payment metadata, and saved provider reference all matched. Docklane saved `CONFIRMED` / `CAPTURED`, allocated its one reserved unit, and recorded exactly one payment-confirmation audit entry. The signed payment-success and checkout-completion webhooks and both corresponding worker tasks were processed. No stock was released or shipped for this confirmed order.

A separate INR 100 order, **DL-10024**, verified the late-payment outcome. Its isolated hold was expired through the reservation service, released once, and its fixture stock cleared and product/site archived. Only that fixture's provider closure/reconciliation tasks were delayed for 15 minutes to model a surviving checkout during a queue outage. The worker was immediately restarted, and the user completed the surviving sandbox checkout after the order had expired.

Stripe confirmed a successful INR 100 payment and one successful full INR 100 refund. Docklane preserved `EXPIRED` / `REFUNDED`, kept the reservation released, and saved one refund-request audit and one refund-success audit. The actual signed `refund.created` and `refund.updated` receipts and their worker tasks were processed, along with the compensation task. The three temporarily delayed fixture tasks were restored and completed; subsequent provider reconciliation still found exactly one refund. DL-10023 remained confirmed with its one-unit allocation.

Final read-only reconciliation covered all 71 development balances. Physical and reserved quantities matched movement sums, and reserved quantities matched active held/allocated reservations, with zero mismatches or oversold balances. All 24 seeded balances retained their original physical stock. All 40 verification balances had zero physical/reserved stock and archived products/sites; the expiry verification customer was inactive. Legitimately expired unpaid seed holds were released while allocated reservations remained protected, including DL-10023's new allocation.

The customer ownership and staff recovery browser cases were rerun after final interface polish. They verify the development-payment label and capture the background-task view on desktop and mobile; these reruns do not add to the 99 distinct checks above.

The saved, verified refund screen was also checked without intercepted responses at 390 and 1366 px. The returned-payment message persisted after reload, the closed order offered no further checkout, and accessibility/layout checks passed. The original paid order still showed confirmation. These provider and interface smoke checks supplement the 99-test suite.

All Phase 5 completion checks passed. Payments remain in Stripe test mode. Shipment operations, ordinary Admin refunds, and returns are now implemented in [Phase 6](PHASE_6.md). The existing tooling dependency limitation remains recorded in [Phase 2](PHASE_2.md#dependency-review).

## Reviewed previews

| View                           | Desktop, 1366 px                                   | Mobile, 390 px                                   |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------ |
| Payment awaiting configuration | [Desktop](previews/phase5-pending-1366.png)        | [Mobile](previews/phase5-pending-390.png)        |
| Payment confirmed              | [Desktop](previews/phase5-confirmed-1366.png)      | [Mobile](previews/phase5-confirmed-390.png)      |
| Reservation expired            | [Desktop](previews/phase5-expired-1366.png)        | [Mobile](previews/phase5-expired-390.png)        |
| Late-payment refund pending    | [Desktop](previews/phase5-refund-pending-1366.png) | [Mobile](previews/phase5-refund-pending-390.png) |
| Full refund, verified sandbox  | [Desktop](previews/phase5-refunded-1366.png)       | [Mobile](previews/phase5-refunded-390.png)       |
| Background-task recovery       | [Desktop](previews/phase5-tasks-1366.png)          | [Mobile](previews/phase5-tasks-390.png)          |

The full-refund previews show DL-10024's saved state after the verified Stripe sandbox refund, using the actual API. Other payment-state previews use intercepted outcomes over a real fixture order; their underlying fixture orders were subsequently cancelled and their stock cleared. Task previews use a simulated failed refund task to show the staff recovery interface.

## Provider references

- [Stripe Checkout Session creation and expiry parameters](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe raw webhook signatures, local listening, duplicates, and event ordering](https://docs.stripe.com/webhooks)
- [Stripe idempotency and key retention](https://docs.stripe.com/api/idempotent_requests)

The migration was tested on the guarded local database and applied to the existing isolated Neon development branch. The parent branch and identity configuration were preserved.
