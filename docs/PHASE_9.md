# Phase 9: Deployment, demo, and portfolio packaging

Status: **complete — the free portfolio demo is live and the required hosted release checks passed on 23 November 2026.**

## Live deployment

On **23 November 2026**, the user applied the reviewed **₹0 Render plan** in My Workspace. The API is live at source revision `1f06786413f9240cf48e95ad59185078c87a8842`; the frontend is live at `861a69cedcbbb6712e3238b72c038841ec8ecc91`, which updates the connected workspace/order labels to describe the demo:

- Product page: [docklane-web-6rpd.onrender.com/welcome](https://docklane-web-6rpd.onrender.com/welcome).
- Sample workspace: [docklane-web-6rpd.onrender.com](https://docklane-web-6rpd.onrender.com).
- Connected sign-in: [docklane-web-6rpd.onrender.com/auth/sign-in](https://docklane-web-6rpd.onrender.com/auth/sign-in).
- API readiness: [docklane-api-6rpd.onrender.com/health/ready](https://docklane-api-6rpd.onrender.com/health/ready).

The frontend is a free static site, the API uses Render's `free` plan, and database/Auth use the existing isolated Neon free branch. There is no hosted paid worker or Redis service. No payment method or upgrade is required. Automatic Blueprint sync and Git deployment remain off. See [deployment](DEPLOYMENT.md) for cold starts, shared quotas and delayed recovery.

Initial frontend/API deployments failed because manual environment settings had not been supplied. The assigned public origins, demo database guard, Auth settings and deployed Stripe sandbox webhook secret were then configured privately; the resulting deployments are live. API readiness and the prerendered `/welcome` page return HTTP 200.

Hosted Admin, Operator and Customer sign-in, reload, API role permissions and logout replay rejection passed. Customer inventory access and Operator team management were denied. A separate customer signup and one user-authorized recovery email passed: inbox delivery, reset and subsequent sign-in were confirmed by the user; changed credentials, old-password rejection and old-session rejection were checked independently. Shared Neon email is used for the demo; commercial email delivery readiness is not claimed.

Customer order **DL-10001** was reserved through the hosted catalog/bag/delivery UI and completed through real Stripe sandbox Checkout for **₹4,999**. Test mode was verified before submission. The signed `checkout.session.completed` and `payment_intent.succeeded` receipts were processed, the saved order became confirmed/captured, and its stock became allocated. Reload displayed the authoritative confirmation.

The same order passed hosted packing and shipment, a **₹100 partial sandbox refund**, physical return receipt, explicit one-unit restock, and the **₹4,899 remaining refund**. Both provider refunds succeeded; the final saved refund total is ₹4,999. Shipment consumed stock and its allocation together; refund and receipt alone left stock unchanged; explicit restock restored the starting balance. The order remains shipped and fully refunded with its audit history retained. Carrier/tracking and delivery information are synthetic. No real money moved.

## Delivered scope

- Free-only Render Blueprint for a static frontend and sleeping API, with PostgreSQL recovery and optional hourly GitHub maintenance. The full local Redis/BullMQ worker remains available. Automatic deployment triggers stay off.
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
- **22 production browser checks** passed in 2.7 minutes: two connected customer/staff cases, three public-page cases, five theme cases, and twelve sample-workspace cases. Combined with domain/database cases, **144 distinct automated checks** passed. These browser cases simulate provider transport; the subsequent hosted Auth/Stripe checks are recorded above.
- The concurrent-request proof again produced **10 reservations / 40 insufficient-stock responses**, with no other outcomes. The local batch took **3,926 ms**; holds were released and its isolated fixture ledger reconciled. This is correctness evidence, not a cloud throughput measurement.
- Docker PostgreSQL backup/restore passed across **19 public tables**, **25 fixture balances**, and **10 fixture orders**. Table contents/digests and sequence state matched, the source was unchanged, and zero invalid balances were found. Provider-owned Auth was excluded; this is an isolated local procedure rehearsal. Archives and reports remain private.
- All **81 original development balances** and **DL-10023** match the earlier Phase 8 preservation baseline. No development seed/reset or live payment was performed.

The previously reported Prisma/Effect advisory is resolved through the compatible scoped patch and working clean installation. Historical Lighthouse measurements in the design notes precede the full theme update; no new current-theme Lighthouse score is claimed.

Eight current desktop/mobile light/dark screenshots were captured and reviewed; see the [demo gallery](DEMO.md#current-release-screenshots). A short public/sample walkthrough is available privately at `.local/release/docklane-walkthrough.webm`. Historical Phase 7 screenshots were preserved.

## Isolated demo and release evidence

On **23 November 2026**, Neon reconnection was verified and `demo-phase-9` (`br-twilight-term-aorpkx3h`) was created from the empty `main` branch in the existing Docklane project. Managed Neon Auth and all six migrations are applied. Three fresh private demo accounts passed real provider sign-in/sign-out checks; all their sessions were closed. Password resets revoke prior sessions. Bootstrap created eight products, three warehouses, 24 balances, three provider-verified profiles and one audit, with zero orders and zero stock-ledger mismatches. The original 81 development balances and DL-10023 still match their preservation baseline.

Demo configuration is in ignored `.env.demo.local`; fresh reviewer credentials are in ignored `.local/release/accounts.json`. The original development environment and account file remain separate. Bootstrap is disabled. Actual hosting origins, the trusted Auth origin and the deployed Stripe sandbox webhook are configured. Hosted tests retain their demo order and audit history.

Fulfillment race assertions replay the actual successful request, recheck the rejected request and verify its actor, allowing either competing role to win. The deployment guard rejects the original development compute across regional DNS variants and allows bootstrap before hosting origins exist. The deployed frontend revision passed the complete [GitHub CI run](https://github.com/benbinu173/Docklane/actions/runs/45125108120): **15 domain/guard cases, 111 database/API cases and 22 browser cases (148 total)**, plus dependency audit, formatting, lint, type checking, builds and the concurrency proof. The API's free-deployment revision also passed the [preceding complete CI run](https://github.com/benbinu173/Docklane/actions/runs/45118235743).

The free-only deployment supersedes the earlier $24/month proposal. Its API processes PostgreSQL recovery while awake; an optional hourly GitHub job remains disabled. Full Redis/BullMQ operation remains available locally. The approved Blueprint contains two services and one shared environment group, with automatic sync disabled.

The database recovery path passed three PostgreSQL checks covering concurrent expiry, late-capture compensation across competing recovery processes, and pending work with unavailable provider credentials. These are included in the 148-case CI result; they are separate from hosted smoke verification.

## Restart, expiry and release artifacts

The existing free API was redeployed once to verify a real service restart. Its active customer session, all 24 balances, the confirmed/refunded shipment history and the pending unpaid order/expiry job survived unchanged. The restored session still reached the API, and logout replay was rejected. The API remained on the free plan and source revision `1f06786413f9240cf48e95ad59185078c87a8842`.

Unpaid demo order **DL-10002** expired automatically at its original **30-minute deadline**, after surviving the API restart with its pending recovery job. Exactly one release movement and one expiry audit were recorded; its physical balance stayed unchanged and its held unit was released. The expiry/closure jobs completed and reload showed the saved expiry state. A final reconciliation across all **24 demo balances** found zero invalid stock values, zero stock-ledger mismatches and zero reservation mismatches. No deadline edits, reset or history deletion were used.

Eight hosted staff/customer desktop/mobile light/dark views and two private clips were refreshed against the deployed frontend; [the demo guide](DEMO.md#hosted-connected-order-previews) describes their coverage. The small demo-label change passed the web build, TypeScript checking and frontend lint; release documentation passed formatting and diff checks. The original **81 development balances and DL-10023** still match the preservation baseline. `.env.local` and `.local/demo-accounts.json` remain separate from the hosted demo configuration.

This completes the first portfolio release. Free API sleep, shared quotas and delayed recovery are documented limitations; hourly GitHub maintenance remains optional and disabled. Hosted disaster recovery and commercial email readiness are not claimed by the isolated local backup rehearsal and shared demo mailer. See [deployment](DEPLOYMENT.md), [operations](OPERATIONS.md), and [portfolio material](PORTFOLIO.md).
