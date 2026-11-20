# Phase 8: Correctness, security, and performance

Docklane 0.8.0 completes Phase 8 with API request protection, stronger recovery checks, production-build fixes, and measurements on a representative local dataset. Deployment and demo packaging remain Phase 9.

## Request and identity protection

- General API requests allow 200 per IP per minute. Failed authentication allows 30 rejected attempts per IP; successful requests and identity-service outages do not consume that failure budget. The failure map is bounded to 10,000 addresses.
- Mutations allow 40 per account per minute; payment-session creation has a separate allowance of 12. Stripe webhook ingress allows 300 per IP and is limited before signature verification. Rate-limit responses include a safe error, request ID, and `Retry-After`.
- Proxy trust defaults to zero. Forwarded addresses cannot bypass limits. `TRUST_PROXY_HOPS=1` is available for a deployment behind one trusted hosting proxy; do not enable it for directly reachable services. Limits use process-local storage; multiple API replicas require a shared rate-limit store.
- POST/PATCH API bodies require JSON. Malformed and oversized bodies return safe 400/413 responses. Existing signed webhook raw-body handling remains separate. Helmet headers, generated request IDs, no-store responses, and redacted logs remain active.
- Configuration requires exact allowed origins, HTTPS identity endpoints, matching Auth/JWKS origins, Postgres database protocols, and TLS modes for remote production databases. Development/test HTTP endpoints are limited to loopback. Configuration errors identify fields without printing their values. Stripe keys remain test-only and are configured together with the allowed return origin.
- Invalid JWTs and ended sessions return 401. Unavailable key/session services return retryable 503 responses. Application-owned roles and active status are read for each request.
- Simultaneous first authenticated requests now share one profile: a uniqueness race reads the winning profile rather than returning a data conflict. The security check submits 50 concurrent requests and verifies one profile and 50 successful responses.
- Test migrations reject remote databases and every database name except exact loopback `docklane_test` before invoking Prisma.

## Recovery and connected browser coverage

The regression suite retains reservation/payment/expiry races, shipment/cancellation races, immutable ledger checks, idempotency recovery, bounded refunds, customer ownership, role changes, revocation, and transactional rollback checks.

New recovery checks delay an old worker until another lease has completed the job. Both delayed completion and delayed failure preserve the replacement result and one payment-confirmation audit. A private TCP proxy disconnects the test worker from local Redis without stopping the shared Redis service. The same worker completes a late-payment refund through database fallback, reconnects, and confirms another payment. Stock releases, refund keys, and the movement ledger remain consistent.

`npm run test:connected` exercises the production UI against a separate local API process and real Postgres transactions. It covers a lost reservation response, exact retry, reload, unpaid cancellation, staff packing/shipment, a partial refund, return receipt, and explicit restocking. Refunds and return receipt do not add stock; restocking adds one received unit. Customer and Operator permissions, mobile overflow, and axe checks are included. Identity/provider transport is simulated; JWT signatures, stored sessions, application roles, API behavior, and persistence are real. Separate development Auth suites verify the actual Managed Neon Auth integration.

Success, error, warning, and information notification colors now use darker text. The new browser check caught a success toast at 4.25:1 contrast; its text now passes the small-text requirement while retaining the established palette.

CI enables the connected browser suite with synthetic identity configuration, uses the production frontend preview, and runs the repeatable concurrency proof alongside formatting, lint, type checking, builds, and domain/API tests. Cloud passwords and Stripe credentials are unnecessary for these CI checks.

## Measured query work

The guarded `npm run benchmark:operations` command creates a unique synthetic business only in loopback `docklane_test`. Its fixture contains 1,000 products, 20 warehouses, 20,000 balances, 5,000 orders, 10,000 order items/reservations, 34,000 movements, 3,000 payments, 1,000 shipments, and 5,000 audits. The fixture ledger reconciles with zero mismatches.

The benchmark uses real loopback HTTP, synthetic identity verification, a Prisma pool of 10, and Docker PostgreSQL 17.12. Product and warehouse fields pass the application creation schemas; compact stock/site identifiers pass the resource limits. Hardware: Intel i5-12450H, 12 logical CPUs, 15.7 GiB RAM, Windows, Node 22.16.0. Each route has one initial request and 20 sequential measured requests.

| Route/view                      | Median    | p95       | Response bytes | Rows             |
| ------------------------------- | --------- | --------- | -------------- | ---------------- |
| Inventory, first page           | 113.96 ms | 125.83 ms | 10,906         | 20               |
| Warehouse/category inventory    | 44.82 ms  | 51.89 ms  | 10,875         | 20               |
| Orders, first page              | 87.31 ms  | 97.69 ms  | 14,299         | 20               |
| Search for one matching product | 50.29 ms  | 57.26 ms  | 185            | 1                |
| Operations overview             | 200.58 ms | 214.29 ms | 8,987          | bounded overview |
| Catalog, first page             | 38.79 ms  | 45.50 ms  | 4,152          | 20               |
| Catalog categories              | 16.28 ms  | 17.64 ms  | 140            | 10               |

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` identified the catalog stock aggregation scanning about 20,000 balances to return 400 balances for 20 SKUs. The new concurrent `inventory_balances_sku_idx` migration enables a bitmap index lookup. On the final validated fixture, the ordinary indexed plan took **0.661 ms**. A comparison of the identical read with index/bitmap scans disabled inside one local transaction took **4.278 ms**, scanning all balances. The planner switches affect only that read transaction; no index is dropped and application settings remain unchanged. The existing warehouse/SKU uniqueness constraint remains authoritative.

Category endpoints now use PostgreSQL `SELECT DISTINCT` rather than transferring every product's category for Prisma to deduplicate in memory. The fixture returns 10 category rows instead of 1,000 product rows. Final response timings are shown above; the change bounds database-to-application category transfer by distinct labels.

Existing order/business/date and customer/date indexes already support the measured first-page/history queries: final plan execution was 0.186 ms and 0.173 ms. No additional order or text-search indexes were added. Broad inventory totals still scan the scoped balances; the final inventory page plan took 34.268 ms. Larger datasets should be measured again before changing that query shape.

These are small local samples, not a hosted throughput claim. Local scheduling and warm caches affect timings. Measurements exclude cloud identity, Stripe, internet latency, and hosting cold starts. The index-plan comparison uses the same validated fixture and SQL read. Earlier exploratory fixtures used oversized identifiers and are superseded by `.local/phase8-operations-validated.json`; they are excluded from the final measurements. SQL plans and full reports remain ignored.

```sh
npm run db:test:migrate
npm run benchmark:operations -- --label=baseline
# Reuse the printed fixture while comparing a query/index change:
npm run benchmark:operations -- --fixture=benchmark-<printed-uuid> --label=after
```

Fixtures are retained for comparisons. The script never deletes immutable movements or resets development data. Fixture loading is transactional; integration suites subsequently reset their dedicated test database.

## Production frontend measurements

The build now explicitly selects `NODE_ENV=production` for Vite and prerendering. Previously, `.env.local`/CI test mode selected React's development runtime inside the production bundle. Public routes now load a small shared reset; workspace styling loads with workspace routes. The static product page preloads the regular and medium Geist fonts used above the fold.

| Measurement              | Phase 7                    | Phase 8                |
| ------------------------ | -------------------------- | ---------------------- |
| React vendor JS          | about 475 KB / 145 KB gzip | 262 KB / 83 KB gzip    |
| Initial stylesheet       | 79.6 KB / 16.2 KB gzip     | 2.41 KB / 0.90 KB gzip |
| Lighthouse performance   | 84                         | 92                     |
| Largest contentful paint | 3.8 s                      | 3.1 s                  |
| Cumulative layout shift  | 0.021                      | 0                      |
| Total blocking time      | 30 ms                      | 10 ms                  |
| Lighthouse accessibility | 100                        | 100                    |

The final local mobile Lighthouse run also scored 100 best practices and 92 SEO, with 2.1-second speed index. Lighthouse 12.8.2 used local production preview and Playwright Chromium's mobile throttling. These single-run scores are diagnostic measurements. Ordinary/reduced-motion hydration and styled readability with JavaScript disabled passed. Preserve the static `/welcome` host-routing requirement in the [Phase 7 notes](PHASE_7.md).

The lockfile dependency audit reported zero advisories during Phase 8 verification. A subsequent 20 November 2026 audit found three high findings in the Prisma/Effect chain ([GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw)). Phase 9 preparation resolved these using a scoped Effect 3.22.1 patch and root Prisma tooling; clean installation, working Prisma/deployment builds, and a full zero-finding audit passed. See the [Phase 9 record](PHASE_9.md). Historical findings describe their dated audit results.

## Verification commands

Validation passed **139 distinct automated checks**: eight domain, 103 PostgreSQL/API, and 28 production browser tests. The browser count includes focused reruns after making the final scan wait for the restored timeline, loaded fonts, and settled mobile layout. Formatting, lint, full type checking, and all workspace builds pass. The separate concurrency proof again produced exactly 10 reservations and 40 insufficient-stock responses, then released its holds and reconciled the ledger.

All **81 original development balances**, including quantities and versions, and **DL-10023** remain unchanged. Four additional browser fixture balances were cleared and archived. The SKU index migration was tested against the representative dataset and applied through the supplied direct development connection. No live payment or deployment occurred. Private accounts, configuration, diagnostics, and reports remain ignored.

The [GitHub workflow](https://github.com/benbinu173/Docklane/actions) runs the 128 checks that do not need cloud accounts, plus the concurrency script. The 11 development Auth browser checks run separately through the redacting runner.

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run prove:concurrency
npm run test:e2e
npm run test:connected
```

Install Chromium first on a fresh machine. Connected checks require the isolated test database, compiled shared packages, and an Auth-configured web build; CI supplies a synthetic Auth URL. For a production-preview check, set `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173` before running the browser command. The separate guarded development Auth runner remains documented in the README.
