# Docklane checkout concurrency proof

Verified: 2026-11-18T10:33:27.451Z.

| Measurement                             | Result  |
| --------------------------------------- | ------- |
| Available units before requests         | 10      |
| Simultaneous distinct customer requests | 50      |
| Successful orders/reservations          | 10      |
| Insufficient-stock responses            | 40      |
| Other responses                         | 0       |
| On-hand units after requests            | 10      |
| Reserved units after requests           | 10      |
| Available units after requests          | 0       |
| Reservation movements                   | 10      |
| Unique order IDs                        | 10      |
| Request batch elapsed time              | 1184 ms |

Environment: Node v22.16.0; PostgreSQL 17.12 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit; Windows loopback; application pool limited to 10 connections.

Run `npm run prove:concurrency` after local migrations and shared-package compilation. The harness uses the production Express routes and reservation service against the dedicated `docklane_test` database. Its synthetic identity verifier replaces cloud Auth; real roles and database checks remain active. All 50 requests start before responses are awaited. No expiry worker runs during the proof. This is correctness evidence, not a hosted performance benchmark.

The harness uses its own business, product, site, and 50 customer profiles. It cancels successful orders, reconciles the ledger, clears physical fixture stock through an adjustment, and archives its product/site. Durable order/movement history remains in the test database.
