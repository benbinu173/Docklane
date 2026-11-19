# Docklane

**Every order, moving forward.**

Docklane is an order and inventory platform with a navy, mist, and lime visual identity. Its central engineering objective is preventing overselling when customers order simultaneously.

**Phases 1-6 are complete.** Docklane combines an interactive staff prototype with a real Express API, PostgreSQL, Managed Neon Auth, role checks, and saved orders. The connected order lifecycle includes stock reservations, Stripe test checkout and refunds, automatic expiry, packing and shipment, paid cancellation, received returns, explicit restocking, and background recovery. See [the build plan](docs/PROJECT_PLAN.md) and [Phase 6 delivery notes](docs/PHASE_6.md).

## Open the current workspace

Use Node.js 22.12 or newer; this workspace was verified on Node.js 22.16.0. Its development environment, identity accounts, and Stripe test credentials are configured locally. Hosted test purchases, full late-payment refunds, session creation/closure, and actual signed webhook delivery have passed verification; automatic reservation expiry also works without Stripe credentials.

```sh
npm ci
docker compose --env-file .env.local up -d --wait
npm run dev
```

Open [Docklane](http://127.0.0.1:5173), then choose **Sign in to Docklane**, or open [sign-in](http://127.0.0.1:5173/auth/sign-in) directly. Development credentials are in the ignored `.local/demo-accounts.json` file. Admin, Operator, and Customer accounts open the appropriate view.

To run only the public prototype, use `npm run dev:web`; it works without cloud configuration. To run only the API, use `npm run dev:api`. `npm run dev` also starts the worker; `npm run dev:worker` runs it separately. Worker readiness is at [localhost:4010/health/ready](http://localhost:4010/health/ready). API readiness is at [localhost:4000/health/ready](http://localhost:4000/health/ready).

## Set up a new development environment

1. Run `npm ci` and `npm run setup:local`. The setup script creates local service defaults and preserves existing configuration.
2. Configure a separate Neon development branch with Managed Auth. Put its pooled database URL, direct migration URL, Auth URL, and JWKS URL in `.env.local`, following [.env.example](.env.example). Set `VITE_NEON_AUTH_URL` to the Auth URL. Register your application origin with Neon Auth.
3. Start PostgreSQL and Redis with `docker compose --env-file .env.local up -d --wait`.
4. Run the following preparation commands, then `npm run dev`:

```sh
npm run db:generate
npm run build:packages
npm run db:migrate
npm run auth:seed
npm run db:seed
```

Auth seeding creates synthetic development accounts and saves generated passwords only in `.local/demo-accounts.json`. Database seeding is repeatable and preserves existing roles and records. Both seed entry points require `ALLOW_DEVELOPMENT_SEED=true` and reject production mode.

Application data can also use local PostgreSQL: set the application pooled/direct URLs to the local `docklane` database, and set `NEON_AUTH_DATABASE_URL` to the branch containing Managed Auth. Integration tests always use the separate, loopback-only `docklane_test` database.

Never commit `.env.local`, `.local`, or connection credentials. Redis supports the Phase 5 BullMQ worker. An independent database sweep also releases expired holds while Redis is unavailable.

## What works

- Public prototype: inventory filters, sorting, pagination, export, stock drawers, sample adjustments, order drawers, simulated packing, warehouse views, command menu, and responsive navigation.
- Identity: customer signup, sign-in, sign-out, session restoration, password recovery/reset, protected routes, and explicit failure states.
- Connected workspace: saved inventory totals, warehouse summaries, searchable order lists, separate order/payment/fulfillment states, and order details.
- Products and warehouses: Admin create/edit/archive/restore flows, immutable SKUs, INR prices, site details, and an accessible warehouse explorer.
- Inventory: API-backed combined filters, sorting, pagination, zero-count tracking, reviewed stock adjustments, thresholds, and immutable movement history. Admins and Operators can correct stock; reserved units stay protected.
- Customer account: a responsive collection and product details with saved prices/availability, its own order history, delivery details, and account information.
- Checkout: identity-scoped saved bags, server price reviews, all-or-nothing single-warehouse reservations, exact-request recovery after a lost response/reload, and unpaid cancellation with stock release.
- Payments and recovery: Stripe test checkout, raw signed webhooks, current-state reconciliation, duplicate protection, automatic stock-hold expiry, and durable full test refunds for late payments. Hosted sandbox purchases, session closure, and full late-payment refunds are verified.
- Fulfillment and returns: packing, manual carrier/tracking details, atomic shipment, paid cancellation, Admin-only partial/full refunds, received returns, explicit restocking, and actor-stamped order history.
- Operations: staff background-task filters/counts and Admin-only reviewed retries with transactional audit records.
- Admin access: role changes with a confirmation dialog and transactional audit records. Operators cannot manage roles or issue refunds. Customers cannot view another customer's orders.

The public prototype uses in-memory sample changes that reset on reload. Connected catalog, warehouse, stock, order, shipment, refund, and return changes persist in PostgreSQL. The worker releases due unpaid holds and processes Stripe test refunds. Admins and Operators can pack, ship, receive returns, and explicitly restock them. Ordinary refunds are Admin-only. Shipment tracking details are entered manually.

After sign-in, staff can open **Products**, **Inventory**, **Warehouses**, and **Orders**. Customers can shop **Collection**, open **My bag**, review delivery/prices, and reserve an order. Continue to Stripe test payment from a new saved order after [configuration](docs/PHASE_5.md#run-the-application). No real money is charged.

## Verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
```

On a fresh machine, install Chromium with `npx playwright install chromium`. Ordinary browser tests start the web server automatically and require no cloud credentials. Integration tests require the local PostgreSQL service.

Real development identity checks run separately, with API and web servers running:

```sh
npm run test:auth
npm run test:auth -- --phase3
npm run test:auth -- --phase4
npm run test:auth -- --phase5
npm run test:auth -- --phase6
npm run test:auth -- --all
```

The identity suite checks real role-specific login, reload, logout replay rejection, ownership, signup, and password reset. The Phase 3 suite checks product/site management, stock persistence, stale-edit recovery, lost-response retries, customer catalog permissions, account-loading recovery, and responsive accessibility. The Phase 4 suite checks saved bags, delivery/price review, reservations, lost-response/reload recovery, later bag additions, changed prices, unavailable quantities, unpaid cancellation, staff visibility, and responsive accessibility. The Phase 5 suite checks payment/error recovery, return-URL behavior, pending/confirmed/expired/refund screens, responsive accessibility, and staff recovery controls. Its payment outcomes are intercepted for UI verification; database checks use a deterministic provider stand-in with real Stripe signature verification. The Phase 6 suite checks real test refunds, fulfillment, paid cancellation, return/restock operations, lost-response retries, and responsive accessibility with isolated fixtures. `--all` runs all five identity suites with the public prototype suite.

Phase 5 local verification passed all 99 tests: seven domain, 60 PostgreSQL/API, and 32 production browser checks. The full browser run used the compiled API and production frontend, finished in 12.7 minutes, and included accessibility/layout checks at 390, 768, 1366, and 1440 px. Formatting, lint, type checking, and builds pass. Additional hosted Stripe sandbox purchase/refund and actual saved-interface smoke checks passed. See [the Phase 5 delivery notes and previews](docs/PHASE_5.md#verification) for the verification coverage.

Phase 6 validation covers **125 passing checks**: eight domain, 80 PostgreSQL/API, and 37 production browser checks, including focused reruns after fixes. Actual partial/full/cancellation Stripe test refunds and a lost-response stock retry passed. Final reconciliation found zero stock-ledger/reservation mismatches across 81 balances and zero excessive refunds. All 71 prior physical/reserved balances and DL-10023 were preserved. See [Phase 6 verification](docs/PHASE_6.md#verification).

The running development worker also passed an isolated automatic-expiry check. After Stripe configuration, a real hosted test session was created, recovered on retry, and closed by the worker after unpaid cancellation; the actual signed expiry webhook was received and processed. The user completed DL-10023's INR 1,499 sandbox checkout, with one confirmation audit and one-unit allocation. The expired DL-10024 fixture then received an INR 100 test payment and one full automatic Stripe refund; repeated reconciliation preserved that single refund and released stock. A final read-only reconciliation found no mismatches between the development stock balances, movement ledger, and active reservations; seeded physical stock was preserved and verification fixtures were cleared and archived.

Run `npm run prove:concurrency` against the dedicated local test database to reproduce the central correctness check: 10 available units and 50 concurrent one-unit requests produce exactly 10 successful orders and 40 insufficient-stock responses. The [concurrency report](docs/CONCURRENCY_PROOF.md) records the measured local batch and ledger results; it is not a hosted performance benchmark.

These checks capture clean previews intentionally. Reset verification reads a provider-generated token from the development database; it does not establish inbox delivery. Auth traces and failure screenshots are disabled; automatic failure page snapshots are suppressed. The runner redacts credentials and reset tokens from output and text diagnostics. The Admin demo password was rotated during Phase 3 verification; use the current credential in `.local/demo-accounts.json`.

The [CI workflow](.github/workflows/ci.yml) configures PostgreSQL/Redis and runs formatting, linting, type checking, builds, domain/API tests, and the public browser suite. Live Auth checks stay outside ordinary CI.

The dependency audit has an unresolved `picomatch` advisory through build/test tooling. Neon Auth's optional Vitest peer makes some tooling appear in `--omit=dev` results. See [Phase 2 dependency notes](docs/PHASE_2.md#dependency-review) for scope; do not use a forced downgrade.

## Stack and documents

React/Vite/TypeScript, Tailwind v4, customized shadcn/Radix, self-hosted Geist, Motion, Phosphor, TanStack Query/Table, Express, Zod, Prisma, PostgreSQL, Managed Neon Auth, Vitest, Playwright, and axe. The Phase 5 worker uses BullMQ and ioredis; Stripe test payments require configuration before a hosted purchase.

`apps/web` contains the interface; `apps/api` contains the API; `packages/contracts`, `packages/domain`, and `packages/database` contain shared foundations. The npm lockfile pins resolved versions. `apps/worker` runs outbox dispatch, payment reconciliation, and independent expiry sweeps.

- [Project roadmap](docs/PROJECT_PLAN.md)
- [Design direction](docs/DESIGN.md)
- [Phase 1 delivery and previews](docs/PHASE_1.md)
- [Phase 2 delivery](docs/PHASE_2.md)
- [Phase 3 delivery and previews](docs/PHASE_3.md)
- [Phase 4 delivery and previews](docs/PHASE_4.md)
- [Phase 5 delivery, setup, and previews](docs/PHASE_5.md)
- [Phase 6 fulfillment, refunds, returns, and previews](docs/PHASE_6.md)
- [Repeatable concurrency proof](docs/CONCURRENCY_PROOF.md)
- [Asset sources](docs/ASSETS.md)

Next: [Phase 7 complete UX, operations views, and landing page](docs/PROJECT_PLAN.md#phase-7-complete-ux-operations-views-and-landing-page).
