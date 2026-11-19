# Phase 3: Products, warehouses, and inventory

Status: complete. Verified on 18 November 2026.

Docklane now has persisted catalog and warehouse management, a transactional stock-adjustment service, a connected inventory workspace, and customer catalog browsing. The public prototype remains available separately.

## Open the new screens

Run `npm run dev` and sign in with the locally saved development accounts.

| Role     | Screens and actions                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Admin    | Products, warehouses, inventory, and existing access management; create, edit, archive, and restore products/sites |
| Operator | Browse products/sites; track stock, adjust counts, and update reorder thresholds                                   |
| Customer | Browse the collection and product details with saved INR prices; read their existing orders                        |

Staff routes: `/workspace/products`, `/workspace/inventory`, `/workspace/warehouses`, and `/workspace/warehouses/:id`. Customer routes: `/account/catalog` and `/account/catalog/:sku`.

## Stock correctness

A new stock level starts at zero. Goods enter the ledger through a reasoned adjustment. Staff can add stock, remove stock, or set a physical count, with a review step before the command is submitted.

Adjustments lock the actor, product, warehouse, and balance in a consistent order. The server verifies the current record version and protects reserved quantities. A transaction commits the balance, its movement, the audit event, and the saved retry result together; an injected audit failure rolls all of them back.

The retry key is scoped to the actor and operation, with a normalized request fingerprint. Simultaneous identical requests return one saved outcome. Reusing a key for another payload is rejected. The browser retains the same key when retrying an identical command after a failed or lost response.

PostgreSQL rejects movement updates and deletions with a trigger. A unique balance/version pair protects adjustment history. Threshold changes have an audit entry and advance the balance version without changing physical quantities; they do not create stock movements.

Products with reserved stock cannot be archived. Archived products disappear from the customer catalog, retain their history, and permit physical stock reductions; adding stock requires restoration. Warehouses can be archived only when their stock is empty and no open orders remain. Product price edits preserve existing order-item snapshots.

## Interface

Inventory search, stock views, warehouse/category/archive filters, sorting, pagination, and selected-stock links are backed by the API. Counts distinguish on hand, reserved, and available. A side panel presents the current balance, reviewed corrections, thresholds, and paginated movement history without losing list context.

Products have immutable SKUs, integer-paise prices, configurable image/backdrop details, and explicit archive confirmations. The warehouse explorer shows modeled sites, with keyboard-accessible links and a matching site list. Details show addresses, site leads, priorities, and actual stock.

The customer collection uses the same navy, mist, lime, and Geist system, with product imagery and a quieter shopping layout. Drawer transitions, confirmed-count highlights, and image/site hover feedback have reduced-motion equivalents. Ordering is clearly marked as upcoming.

## API and migration

`packages/database/prisma/migrations/20261118090000_inventory/migration.sql` adds record versions and database movement protection. It was tested on the loopback-only `docklane_test` database and applied to the existing isolated Neon development branch. The parent branch is preserved.

New endpoints under `/api/v1`:

- Products and categories: `GET/POST /products`, `PATCH /products/:sku`, `GET /products/categories`.
- Customer catalog: `GET /catalog`, `GET /catalog/:sku`, `GET /catalog/categories`.
- Warehouses: `GET/POST /warehouses`, `GET/PATCH /warehouses/:id`.
- Stock: `GET/POST /inventory`, `GET /inventory/:id`, `GET /inventory/:id/movements`, `POST /inventory/:id/adjustments`, `PATCH /inventory/:id/threshold`.

Lists have bounded pages; inventory SQL uses parameterized filters and whitelisted sort expressions. Inventory rows, totals, and summary counts share a repeatable-read snapshot, as do catalog availability and warehouse totals. Choice lists are capped at 100 results with server search for larger catalogs/networks. Staff category choices also include archived products. Roles and business ownership are enforced on the API; hiding UI actions complements these checks.

## Verification

All 63 tests pass against the completed Phase 3 implementation:

| Suite              | Passed | Environment                                                      |
| ------------------ | ------ | ---------------------------------------------------------------- |
| Domain             | 7      | Lifecycle and stock rules                                        |
| PostgreSQL/API     | 31     | Dedicated loopback `docklane_test` database                      |
| Production browser | 25     | Compiled API, production web build, development Auth/data branch |

The API suite contains 15 original foundation tests, one connection-recovery regression, and 15 stock/resource checks. These cover concurrent stale edits, concurrent identical retries, conflicting keys, protected reservations, rollback, append-only movements, ledger reconciliation, thresholds, price snapshots, archive rules, and business isolation. The browser suite contains seven identity checks, six Phase 3 checks, and 12 public-prototype regressions; the final run passed in seven minutes.

The six live Phase 3 browser checks use real development identities and synthetic products/sites. They cover complete Admin management, persisted Operator counts, stale-edit recovery, a lost-response retry, customer catalog prices/permissions, account-lookup recovery, and responsive accessibility. Fixtures are cleared and archived; seeded stock is preserved. Credential traces and failure screenshots are disabled.

Inventory, product/warehouse editors, the warehouse explorer/detail, stock drawer, and customer catalog/detail passed automated accessibility and page-overflow checks at 390, 768, 1366, and 1440 px widths. Desktop and mobile previews were reviewed visually. The public regressions also exercise keyboard navigation, focus restoration, and reduced motion. Automated scans complement these checks; they do not establish full accessibility conformance.

Formatting, lint, type checking, shared-package/API compilation, and the production frontend build pass. The final read-only development reconciliation found zero ledger mismatches, with eight active products, three active warehouses, 24 active stock levels, and 16 seeded orders preserved. The reference `AUD-001` balance at Kochi remains 86 on hand and one reserved. API readiness, the development web server, and the production preview all returned HTTP 200.

An idle authentication database connection error no longer terminates the API. The local PostgreSQL regression deliberately terminates a uniquely named test connection, observes its pool error, then verifies that `/me` succeeds through a new backend connection. The web app also shows a retry action when a signed-in account cannot load; successful provider sign-in clears the password field while retaining the session.

```sh
npm run test:integration
npm run test:auth -- --phase3
npm run test:auth -- --all
```

The compiled API was stopped and restarted with an isolated nine-unit fixture. Its balance, version, and single movement survived. The fixture and records left by interrupted checks were cleared and archived through the authorized API. A read-only query reconciled every development balance with the sums of its on-hand/reserved movement deltas; no mismatches were found.

The production preview's explicit `http://127.0.0.1:4173` origin is registered on the development Auth branch. The Admin demo password was rotated after a diagnostic exposed it; the previous credential is rejected, other Admin sessions were revoked, and the current credential is saved only in the ignored `.local/demo-accounts.json` file. Automatic failure page snapshots are suppressed and text diagnostics/output are redacted by the Auth test runner.

## Reviewed previews

| Screen           | Desktop                                              | Mobile                                             |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Inventory        | [1366 px](previews/phase3-inventory-1366.png)        | [390 px](previews/phase3-inventory-390.png)        |
| Stock drawer     | [1366 px](previews/phase3-stock-drawer-1366.png)     | [390 px](previews/phase3-stock-drawer-390.png)     |
| Products         | [1366 px](previews/phase3-products-1366.png)         | [390 px](previews/phase3-products-390.png)         |
| Warehouses       | [1366 px](previews/phase3-warehouses-1366.png)       | [390 px](previews/phase3-warehouses-390.png)       |
| Warehouse detail | [1366 px](previews/phase3-warehouse-detail-1366.png) | [390 px](previews/phase3-warehouse-detail-390.png) |
| Customer catalog | [1366 px](previews/phase3-catalog-1366.png)          | [390 px](previews/phase3-catalog-390.png)          |

## Boundary

Checkout, reservation creation, the 50-request overselling proof, payments, fulfillment mutations, refunds, and returns remain in their planned phases. Existing orders are seeded examples. This phase proves safe stock corrections and retries; the checkout concurrency proof belongs to Phase 4.

The dependency limitation recorded in [Phase 2](PHASE_2.md#dependency-review) remains unchanged. Movement history and audit/idempotency records are durable; automatic retention and background cleanup enter with later worker work.
