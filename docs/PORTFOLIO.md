# Docklane portfolio material

**Docklane — Order and Inventory Platform**

A full-stack TypeScript application for multi-warehouse inventory, simultaneous checkout, Stripe test payments, fulfillment, refunds, and explicit return restocking. React, Express, PostgreSQL/Prisma, Managed Neon Auth, Redis/BullMQ, Playwright, and Vitest.

## Resume bullets grounded in implemented work

- Built a React and Express order/inventory platform with role-based access, multi-warehouse stock, Stripe test Checkout, shipment tracking, refunds and audited return restocking.
- Designed transactional inventory reservations and request idempotency; verified that fifty concurrent one-unit requests against ten units produce exactly ten successful reservations with no overselling.
- Implemented durable PostgreSQL outbox processing, BullMQ jobs, expiry sweeps and provider reconciliation to recover payment/refund work across worker restarts and queue outages.
- Created responsive staff/customer workflows with persisted Light/Dark/System themes, accessible keyboard interactions and reduced-motion animations; verified workflows using Playwright and PostgreSQL integration tests.

Use the bullets appropriate to the space available. Add a deployed-demo claim or link only after hosted smoke verification. Historical query/browser measurements are reproducible local results in [Phase 8](PHASE_8.md); do not present them as cloud throughput or current theme Lighthouse measurements.

## Interview explanation

Start with the failure scenario: two customers read the last unit before either writes. Explain the row lock/recheck transaction, all-or-nothing multi-line order, and durable movement/idempotency records. Then describe why Stripe calls stay outside database locks, why late capture needs compensation, and why Redis delivery is backed by a database outbox. Finish with explicit tradeoffs: one business, one warehouse per order, simulated transport in CI, sandbox payments, and process-local rate limits.

Repository: [benbinu173/Docklane](https://github.com/benbinu173/Docklane). Architecture: [system and tradeoffs](ARCHITECTURE.md). Demo flow: [guided review](DEMO.md). Current release progress and verification: [Phase 9](PHASE_9.md).
