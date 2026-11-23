# Phase 9: Deployment, demo, and portfolio packaging

Status: **in progress — release preparation implemented; hosting remains pending.** No live demo URL or completed hosted verification is claimed.

## Prepared deliverables

- Free-only Render Blueprint for a static frontend and sleeping API, with PostgreSQL recovery and optional hourly GitHub maintenance. The full local Redis/BullMQ worker remains available. Deployment triggers stay off pending review.
- HTTPS/test-payment environment validation, matching demo database/Auth target guards, direct migration checks, and a separate `.env.demo.example`.
- One-time demo bootstrap with provider-verified identities, catalog/warehouse/opening stock and audited roles. It rejects populated tables and development targets. Reset uses fresh-branch rotation.
- Local Docker dump/restore rehearsal tooling with table digests, sequence verification, stock checks and a fresh restore database.
- Architecture, operations, deployment setup, role-specific demo guide, screenshot/walkthrough capture script and evidence-based resume bullets.
- Complete Light/Dark/System appearance and interactive motion improvements prepared during the release candidate UI review.
- A high-severity dependency audit now runs in GitHub CI after installation.

## Verification record

Verification on 20 November 2026:

- Clean Linux Node **22.23.5** installation with `npm ci --include=dev`, a valid dependency tree, and complete patched Effect **3.22.1** module loading passed. Backend and frontend deployment build commands passed; the full dependency audit reported **zero findings**. The shared Prisma CLI remains on stable **7.10.1** at the repository root.
- Windows Node **22.16.0** full workspace build, type checking, linting and formatting passed. The final tooling type check also passed after the bootstrap fixes.
- **14 domain/deployment guard checks** and **108 database/API checks** passed. The API count comprises 103 existing regression cases and five new bootstrap cases, including competing bootstraps, repeat refusal, identity mismatch and rollback. Initial bootstrap failures were corrected and rerun; no database constraint was weakened.
- **22 production browser checks** passed in 2.7 minutes: two connected customer/staff cases, three public-page cases, five theme cases, and twelve sample-workspace cases. Combined with domain/database cases, **144 distinct automated checks** passed. Connected provider transport is simulated; hosted Auth/Stripe smoke checks remain pending.
- The concurrent-request proof again produced **10 reservations / 40 insufficient-stock responses**, with no other outcomes. The local batch took **3,926 ms**; holds were released and its isolated fixture ledger reconciled. This is correctness evidence, not a cloud throughput measurement.
- Docker PostgreSQL backup/restore passed across **19 public tables**, **25 fixture balances**, and **10 fixture orders**. Table contents/digests and sequence state matched, the source was unchanged, and zero invalid balances were found. Provider-owned Auth was excluded; this is an isolated local procedure rehearsal. Archives and reports remain private.
- All **81 original development balances** and **DL-10023** match the earlier Phase 8 preservation baseline. No development seed/reset or live payment was performed.

The previously reported Prisma/Effect advisory is resolved through the compatible scoped patch and working clean installation. Historical Lighthouse measurements in the design notes precede the full theme update; no new current-theme Lighthouse score is claimed.

Eight current desktop/mobile light/dark screenshots were captured and reviewed; see the [demo gallery](DEMO.md#current-release-screenshots). A short public/sample walkthrough is available privately at `.local/release/docklane-walkthrough.webm`. Historical Phase 7 screenshots were preserved.

## Pending external setup and hosted evidence

On **23 November 2026**, Neon reconnection was verified and `demo-phase-9` (`br-twilight-term-aorpkx3h`) was created from the empty `main` branch in the existing Docklane project. Managed Neon Auth and all six migrations are applied. Three fresh private demo accounts passed real provider sign-in/sign-out checks; all their sessions were closed. Password resets revoke prior sessions. Bootstrap created eight products, three warehouses, 24 balances, three provider-verified profiles and one audit, with zero orders and zero stock-ledger mismatches. The original 81 development balances and DL-10023 still match their preservation baseline.

Demo configuration is in ignored `.env.demo.local`; fresh credentials are in ignored `.local/release/accounts.json`. The original development environment and account file remain separate. Bootstrap is disabled in the saved environment after preparation. Hosting/payment values are awaiting actual assigned domains and the deployed webhook secret.

The first GitHub release run failed a fulfillment race assertion: it assumed the Admin request won, although the Operator request could win legitimately. Receipt, restock and refund checks now replay the successful request, recheck the rejected request and verify the actual actor. All 20 fulfillment cases and 15 domain/deployment guard cases passed after correction. The guard also rejects the original development compute across regional DNS variants and allows data bootstrap before hosting origins exist. The corrected code passed the complete [GitHub CI run](https://github.com/benbinu173/Docklane/actions/runs/45113445652): 15 domain/guard cases, 108 database/API cases and 22 browser cases (**145 total**), plus dependency audit, formatting, lint, type checking, builds and the concurrency proof.

The user's latest requirement is **no payment from their side**. The free-only Render proposal supersedes the $24/month proposal and billing setup request. Its API processes PostgreSQL recovery while awake; an optional disabled-by-default hourly GitHub job handles idle periods. Full Redis/BullMQ operation remains available locally. The existing Blueprint has no resources and automatic sync disabled; regenerate its plan from the free file and obtain explicit application approval. Free quotas, cold starts and delayed maintenance are documented in [deployment](DEPLOYMENT.md).

The new database recovery path passed three PostgreSQL checks covering concurrent expiry, late-capture compensation across competing recovery processes, and pending work with unavailable provider credentials. Build, lint and tooling checks are recorded as they complete. Full hosted verification remains pending.

Hosted account recovery, signed Stripe webhook delivery, checkout/refund/fulfillment, worker expiry/restart and live direct-link routing remain required. See [deployment checks](DEPLOYMENT.md), [operations](OPERATIONS.md), [demo guide](DEMO.md), and [portfolio bullets](PORTFOLIO.md). Phase 9 is complete only after these checks pass and the live link and verified walkthrough are available.
