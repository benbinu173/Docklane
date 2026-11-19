# Phase 2: API, identity, and database foundation

Delivery date: 18 November 2026, Asia/Kolkata.

Status: complete. Phase 3 is next.

## Delivered foundation

Docklane now has an Express API and shared contracts, domain, and database workspaces. Prisma tracks products, warehouses, stock balances/movements, order snapshots, reservations, payments, refunds, shipments, returns, webhook receipts, idempotency records, outbox events, audits, and application profiles.

The first migration includes foreign keys, uniqueness rules, quantity checks, INR/integer-money checks, and the inventory constraints `onHand >= 0`, `reserved >= 0`, and `reserved <= onHand`. Lifecycle transitions and permission rules are shared domain code. This schema prepares later operations; it does not implement the reservation or payment engines.

The repeatable seed initially creates 24 warehouse/SKU balances, 16 orders, and 18 application profiles. Opening, reservation, shipment, and release movements reconcile with every seeded balance. Some historical customer profiles have explicitly synthetic identity subjects; actual development sign-in accounts are stored separately in `.local/demo-accounts.json`. Browser checks create additional synthetic customer profiles.

## Environments

The Neon project is `docklane`, in AWS Singapore, with PostgreSQL 17 and an isolated `dev-phase-2` branch. The parent `main` branch was preserved. Managed Auth is enabled on the development branch. Application traffic uses a pooled connection; migrations use the direct connection.

Local Docker Compose supplies PostgreSQL 17 on `127.0.0.1:55432` and Redis 7 on `127.0.0.1:56379`. It creates separate `docklane` and `docklane_test` databases and keeps their volumes. Redis is infrastructure for the later worker; it is not currently required by an API request.

The migration has been applied to the isolated Neon branch and local test database. Secrets remain in ignored local files. Environment loading is rooted at the workspace for both API and Vite; only the public Auth/API URLs use `VITE_` names.

## Identity and authorization

The custom branded interface uses Managed Neon Auth through `@neon/auth`. It provides sign-in, Customer signup, password recovery/reset, reload restoration, and sign-out. Reset completion closes the current session and returns to sign-in. Session restoration cannot reinstate a stale session after logout or component cleanup. The browser keeps JWTs only in memory; the provider owns its HttpOnly session cookie.

Every API call requires both an EdDSA JWT and an `X-Docklane-Session` opaque provider token. The API validates the issuer and token lifetime, then checks that the stored provider session exists, belongs to that JWT subject, and has not expired. Logout therefore rejects replay of an otherwise valid JWT/session pair immediately.

Application roles are loaded from `user_profiles` on every request. Provider JWT role claims do not grant application privileges. New identities default to Customer; inactive profiles are denied. Customers' list and detail queries include their profile ID, and an unowned order returns 404 without an address. Staff queries remain scoped to the configured business.

Admin role changes lock the business row, recheck the acting admin in the transaction, preserve an active admin, and commit the profile change with an audit event. Self-role changes are denied. Operators cannot manage roles or reach the refund handler.

### Managed SDK details

The installed SDK is `@neon/auth@0.8.2`. Its inferred declarations omit the JWT plugin's `.token()` endpoint; the integration uses the wrapper's typed `$fetch('/token')` instead. No custom plugins, type casts to invented SDK methods, or dependency overrides were added.

Session restoration disables the provider cookie cache and uses the SDK's `X-Force-Fetch` escape hatch. Explicit credentials and no-store fetches preserve the login flow. The SDK replaces `session.token` with a JWT when it receives `set-auth-jwt`; an `onResponse` hook retains the original opaque token separately for the API's provider-session check. This token remains in memory. Forced JWT fetches avoid the SDK treating `/token` as a cached session response.

## API and connected screens

| Endpoint                                  | Access and behavior                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `GET /health/live`                        | Process liveness                                                           |
| `GET /health/ready`                       | Database/schema and business readiness                                     |
| `GET /api/v1/me`                          | Active application profile                                                 |
| `GET /api/v1/workspace`                   | Admin/Operator warehouse and stock totals, recent orders                   |
| `GET /api/v1/orders`                      | Search, status, bounded pagination; customer ownership scope               |
| `GET /api/v1/orders/:identifier`          | UUID/order number; customer ownership scope                                |
| `GET /api/v1/team`                        | Admin-only member list                                                     |
| `PATCH /api/v1/team/:id`                  | Admin-only audited role change                                             |
| `POST /api/v1/orders/:identifier/refunds` | Permission gate only; permitted callers receive explicit 501 until Phase 6 |

Validation and errors use consistent safe response shapes with request IDs. The API has origin restrictions, security headers, bounded request bodies, rate limiting, and structured logging that omits request credentials and bodies. Readiness does not prove external email delivery.

Connected routes are `/workspace`, its saved orders/details and Admin people view, and `/account` with customer-owned orders/details. They share Docklane's navy navigation, mist surfaces, lime actions, Geist typography, and restrained motion. Desktop and mobile navigation have explicit loading/error states, keyboard dismissal, and reduced-motion support.

The seven original public prototype routes remain available. Inventory adjustments and packing there still use explicitly identified in-memory fixtures. A sign-in entry connects the public prototype to the new identity screens. Rapid inventory filter changes now compose with the latest committed URL, so typing immediately after choosing a warehouse preserves that warehouse filter.

## Verification

| Check                                   | Result                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Formatting, ESLint, TypeScript          | Passed                                                                                                  |
| Full API/package/web production build   | Passed; final web rebuild also passed                                                                   |
| Domain checks                           | 7 passed                                                                                                |
| PostgreSQL/API integration checks       | 15 passed                                                                                               |
| Public prototype browser workflows      | 12 passed against production preview                                                                    |
| Live managed identity/browser workflows | 7 passed against compiled API and production web preview                                                |
| Combined production browser run         | 19 passed in one run                                                                                    |
| Automated accessibility                 | Zero violations on four Auth screens, five staff/account routes, customer orders, and mobile navigation |
| Responsive checks                       | 390, 768, 1366, and 1440 px; no accidental page overflow                                                |
| Source/document secret scan             | 82 files checked, no configured credential matches                                                      |

The 41 domain, integration, and browser tests cover invalid/expired identities, session binding and revocation, ignored role claims, inactive accounts, customer ownership, Admin/Operator restrictions, audited role changes, strict validation, SQL stock constraints, repeatable seeding, and live signup/password reset. Browser tests also verify connected order filters, existing prototype workflows, keyboard access, and responsive layout.

The compiled API readiness endpoint returned 200. Production browser checks used `http://localhost:4173`, with the compiled API on port 4000. The final customer count label received a small copy correction after the combined run.

To repeat the combined checks with the configured development identities and production servers running:

```sh
# Set PLAYWRIGHT_BASE_URL=http://localhost:4173 in your shell, then:
npm run test:auth -- --all
```

The database test suite uses a dedicated loopback-only `docklane_test` target and a local provider-schema double. It exercises the production signature verifier and session SQL with local Ed25519 keys. It cannot truncate cloud or ordinary application databases.

Live Auth checks require matching, explicitly enabled development credentials. They exercise the managed provider and real API, with traces/failure screenshots disabled. Password reset uses a new synthetic account and the provider-generated reset token read from the development database. This verifies credential replacement and token processing; synthetic `.test` addresses do not verify inbox delivery. Production SMTP and actual email delivery verification remain deployment work.

The CI workflow includes PostgreSQL/Redis services, formatting, linting, type checking, builds, domain and database/API tests, and public browser workflows. The workflow is configured here; a remote CI run requires the repository to be pushed.

### Reviewed previews

- [Sign-in, desktop](previews/sign-in-1366.png) and [mobile](previews/sign-in-390.png).
- [Connected overview, desktop](previews/connected-overview-desktop.png) and [mobile](previews/connected-overview-mobile.png).
- [People and access](previews/people-access-desktop.png).
- [Customer orders, mobile](previews/customer-orders-mobile.png).

## Dependency review

Prisma/client/adapter versions are aligned at 7.10.1, and Vitest is 4.1.12. These versions avoid the earlier deepmerge/mocker advisories encountered during setup. Node 22.12 or newer is required.

The remaining audit findings concern `GHSA-fc5q-39xc-vjpf`, the `picomatch` repeated-extglob denial-of-service advisory, and packages depending on it. The installed advisory has no patched-version range. A full lockfile audit reports 11 high findings; `--omit=dev` reports 5 because Managed Auth's upstream Better Auth package has an optional Vitest peer, so npm classifies shared test tooling as part of the production dependency graph. `npm explain vite` confirms that path.

The current API does not expose arbitrary glob evaluation, and Vite/Vitest are not run to serve the compiled production API. This limits the observed application exposure but does not remove the dependency finding. A forced audit fix proposes breaking tool downgrades; it was not applied. Recheck patched upstream releases before deployment. The Managed SDK also has an upstream Better Fetch peer-version warning; its working dependency graph was preserved.

## Remaining project phases

Phase 3 implements catalog/warehouse management, authorized stock adjustments with immutable movements, and API-backed inventory views. Phase 4 implements and proves concurrent reservations. Test payment processing, expiry workers, shipment actions, refunds, and returns follow afterward.

Phase 2 has no production payment credentials, automated jobs, checkout engine, or shipping integrations. The persisted sample records and role boundary are the foundation for those features.
