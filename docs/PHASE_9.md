# Phase 9: Deployment, demo, and portfolio packaging

Status: **in progress — release preparation implemented; hosting remains pending.** No live demo URL or completed hosted verification is claimed.

## Prepared deliverables

- Candidate Render Blueprint for a static frontend, one API, one worker and persistent `noeviction` Redis; optional Vercel frontend configuration. Deployment triggers remain off pending a reviewed launch.
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

The user confirmed all-Render hosting in **My Workspace** for planning only. Render created Blueprint `exs-dc1s8hutlv9c73cvmplg` with automatic sync disabled. Planning returned `need_payment_info` for the paid API, worker and queue; the Blueprint has no resources and no planned sync. Complete workspace billing setup, then retry planning on this same Blueprint. No deployment is approved. Review the actual resource changes and **$24/month backend baseline** before explicitly approving application. Manual secret/origin values need private configuration. Costs and credentials alone do not authorize deployment.

Hosted account recovery, signed Stripe webhook delivery, checkout/refund/fulfillment, worker expiry/restart and live direct-link routing remain required. See [deployment checks](DEPLOYMENT.md), [operations](OPERATIONS.md), [demo guide](DEMO.md), and [portfolio bullets](PORTFOLIO.md). Phase 9 is complete only after these checks pass and the live link and verified walkthrough are available.
