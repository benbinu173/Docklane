# Phase 6: Fulfillment, refunds, and returns

Docklane 0.6.0 connects packing, shipment, paid cancellation, Stripe test refunds, received returns, and explicit restocking to the saved order page. Shipment tracking is recorded manually. All operational changes are audited and checked by the server.

## Order operations

Admins and Operators can pack a confirmed order with allocated stock, then record its carrier, tracking reference, optional HTTPS tracking URL, and handoff reason. A shipment consumes every allocated unit and reduces both on-hand and reserved stock in the same transaction. It marks the order completed and its reservations consumed. Retrying shipment preserves one shipment and one stock consumption; a different reference cannot replace a recorded shipment.

Unpaid, expired, cancelled, fully refunded, and refund-pending orders cannot ship. A completed partial refund permits fulfillment. A packed order can still be cancelled before shipment. Customers can cancel their own eligible orders; staff can cancel eligible workspace orders. Paid cancellation releases allocation and reserves a refund for the amount not already refunded or reserved by another pending attempt. Cancellation racing with shipment produces one stock outcome.

## Refunds and reconciliation

Only Admins can request ordinary full or partial Stripe test refunds. Amounts are stored in integer paise and bounded by the original capture minus successful and unresolved attempts. The transaction locks the order, saves the amount and stable provider operation key, writes an audit event, and queues durable work before Stripe is called.

The worker verifies the original capture, currency, test mode, and provider association before issuing or reconciling a refund. Provider calls happen outside inventory/database locks. Multiple successful refunds produce a partially refunded or fully refunded payment according to their combined amount. Refunds never change inventory or shipment state.

Lost responses keep their capacity reserved. Provider-pending refunds remain processing. Exhausted or ambiguous work becomes `RECONCILIATION_REQUIRED`; Admins can enqueue another check of the same operation from the refund ledger. An ambiguous operation older than 23 hours only looks up an existing provider result and stops for review if none can be found. It does not reuse a possibly pruned Stripe idempotency key. Capacity is released only after a definitive provider failure. A failed refund on a closed order leaves its compensation obligation visible.

## Received returns and stock

Admins and Operators can record physically received quantities only after shipment. Aggregate receipts cannot exceed the shipped quantities. Receiving a return writes a receipt and audit event without adding stock.

After inspection, staff can restock all or part of each received line into the original warehouse. The command is bounded by received quantity minus previous restocks. Updating the receipt line, physical balance, immutable `RETURN` movement, and audit record happens atomically. Retrying a request replays its saved result; competing requests cannot restore the same units twice. A financial refund and a physical return remain independent operations.

## Connected interface

The order page includes an animated fulfillment progress rail, carrier/tracking details, a payment ledger with captured/returned/pending amounts, received-return records, contextual role-based actions, and a paginated actor-stamped timeline. Forms preserve the same request after an uncertain response. Server validation errors allow correction. Mutation invalidation refreshes order, inventory, and bag data; pending payments/refunds retain bounded refresh.

The existing navy, mist, lime, and sage palette, self-hosted typography, Motion, Phosphor, and Radix dialogs are retained. Responsive order previews are in [desktop](previews/phase6-order-1366.png) and [mobile](previews/phase6-order-390.png).

## API and schema

All routes are under `/api/v1` and require a valid active account/session.

| Route                                                       | Access                 | Result                                          |
| ----------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `POST /orders/:identifier/packing`                          | Admin, Operator        | Checked and packed order                        |
| `POST /orders/:identifier/shipments`                        | Admin, Operator        | One shipment and atomic stock consumption       |
| `POST /orders/:identifier/cancellations`                    | Staff, owning Customer | Eligible stock release and payment compensation |
| `POST /orders/:identifier/refunds`                          | Admin                  | Durable refund attempt; HTTP 202                |
| `POST /orders/:identifier/refunds/:refundId/reconciliation` | Admin                  | Check the existing provider operation; HTTP 202 |
| `POST /orders/:identifier/returns`                          | Admin, Operator        | Received return receipt                         |
| `POST /orders/:identifier/returns/:itemId/restocks`         | Admin, Operator        | Bounded explicit stock restoration              |
| `GET /orders/:identifier/timeline`                          | Staff, owning Customer | Paginated operational audit history             |

Mutation bodies require a UUID `idempotencyKey` and a reason. Shipment, refund, receipt, and restock bodies also contain their respective references, amount, or quantities. Reusing a key with a changed body returns a conflict. Order reads expose the shipment, receipts, refund records, and refund totals.

The additive `20261118160000_fulfillment` migration adds packing time, shipment reason/URL, refund purpose/reconciliation/resolution times, and receipt/timeline indexes. Existing compensation attempts are identified as late-payment refunds. Applied Phase 1–5 migrations remain unchanged. The migration was tested on local `docklane_test` before applying it through the direct connection to the existing Neon development branch; the parent branch was preserved.

## Verification

Eight domain checks and 80 PostgreSQL/API checks pass. The 20 new Phase 6 integration checks cover concurrent/repeated shipments, invalid transitions, cancellation races, ownership and roles, receipt/restock bounds, partial restocks, refund capacity, partial/full outcomes, lost responses, old ambiguous keys, provider failures, and atomic rollback when audit writes fail. Integration tests remain restricted to loopback `docklane_test`.

Real Stripe sandbox verification uses two isolated ₹200/₹100 captures associated with dedicated fixture orders. Capture initialization is a guarded verification helper; packing, shipping, refund requests, cancellation, return receipt, and restocking use the actual connected UI/API. A separate synthetic-payment stock fixture exercises an aborted restock response and retry without an additional Stripe charge. The existing Phase 5 hosted-checkout proof remains separate. No live payments or deployment are part of this phase.

Run the guarded Phase 6 browser checks after preparing their isolated captured fixtures:

```powershell
rtk npm run test:auth -- --phase6
```

The full browser runner includes Phase 6 with `--all`. Fixtures and credentials are held in ignored `.local` files. All 37 browser checks are validated across the full production run and focused reruns after correcting the older empty-filter assumption, a product-loading heading/scan race, and the frozen reason-field label. The final restock retry delivered two identical requests and added stock once.

Final verification totals: **125 checks** — eight domain, 80 PostgreSQL/API, and 37 production browser checks. Formatting, lint, type checking, and builds pass. Responsive accessibility coverage includes 390, 768, 1366, and 1440 px in the regression suite.

Provider reconciliation confirmed two ₹100 refunds for the shipped ₹200 DL-10025 fixture and one ₹100 cancellation refund for DL-10026. Repeated completed-refund processing preserved exactly three provider refunds. The additional stock-retry fixture used a synthetic payment. All Phase 6 fixture stock was cleared and its product/site archived after verification.

The final development reconciliation checked **81 balances** with zero movement/reservation mismatches and zero excessive refund totals. All **71 prior balances** retained their physical and reserved quantities. The original DL-10023 payment/order states, update timestamp, and one allocated unit were preserved. Private evidence is in `.local/phase6-result.json` and `.local/phase6-retry-result.json`.

## Scope

One complete shipment per order is supported. Carrier integration, split shipments, automated labels, and live payments are outside this phase. Returned items require a separate inspection/restock command; receiving or refunding them never adds stock automatically. The remaining broader workspace/landing-page completion belongs to Phase 7.
