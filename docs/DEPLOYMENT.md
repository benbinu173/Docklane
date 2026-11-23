# Free demo deployment

Status: **both services are live**, using the approved **₹0 setup with no payment method**. [The Render Blueprint](../infra/render.yaml) defines only a free static frontend and a free API. The previous paid worker/queue proposal is superseded.

Product: [docklane-web-6rpd.onrender.com/welcome](https://docklane-web-6rpd.onrender.com/welcome). Sign-in: [docklane-web-6rpd.onrender.com/auth/sign-in](https://docklane-web-6rpd.onrender.com/auth/sign-in). API readiness: [docklane-api-6rpd.onrender.com/health/ready](https://docklane-api-6rpd.onrender.com/health/ready).

## Components and costs

| Component               | Deployment                                                        | Service cost             |
| ----------------------- | ----------------------------------------------------------------- | ------------------------ |
| Frontend                | Render static site                                                | $0 within free quotas    |
| API                     | Render Free web service                                           | $0 within free quotas    |
| Database and Auth       | Existing Neon free project / isolated demo branch                 | $0 within free quotas    |
| Recovery                | PostgreSQL outbox processed by the awake API                      | No separate paid service |
| Idle-period maintenance | Optional standard GitHub Actions runner in this public repository | Free runner compute      |
| Payments                | Existing Stripe sandbox and test cards                            | No real payment          |

Keep payment details off Render. Without a payment method, exceeding Render free allowances causes suspension or paused builds instead of an overage bill. Render instance hours are shared with this workspace's other projects. No compute or workspace upgrade is part of this demo.

## Free-host behavior

Render Free APIs sleep after 15 minutes without inbound traffic and take about one minute to wake. The static product/sample UI remains independently available. Data and recovery work stay in Neon, so API restarts preserve authoritative orders, inventory and pending outbox records. Checkout remains transactionally guarded; sleep can delay reservation cleanup, confirmation and refunds.

`BACKGROUND_MODE=database` starts a bounded PostgreSQL recovery loop at a one-minute interval while the API is awake. It shares the existing expiry, provider reconciliation, refund and lease logic. The dedicated Redis/BullMQ worker remains available for full local operation through Docker; hosted recovery has no separate Redis or worker service.

The optional [maintenance workflow](../.github/workflows/demo-maintenance.yml) checks work hourly without pinging the sleeping API. It is disabled until repository variable `DOCKLANE_DEMO_MAINTENANCE=enabled` is set after deployment review. GitHub schedules can be delayed or disabled after repository inactivity. This portfolio demo has delayed background recovery and no continuous-availability promise. That workflow uploads no artifacts.

## Database and private setup

The `demo-phase-9` branch (`br-twilight-term-aorpkx3h`) was created from the empty main branch of the existing Docklane project. All six migrations and Managed Neon Auth are configured. Bootstrap contains eight products, three warehouses, 24 reconciled balances and three private role-specific accounts. The original development database and DL-10023 remain preserved.

Use ignored `.env.demo.local` for credentials and `.local/release/accounts.json` for fresh accounts. Guarded Auth/bootstrap commands can prepare data before public hosting origins exist. Bootstrap stays disabled after setup. See [.env.demo.example](../.env.demo.example), [the demo guide](DEMO.md), and [operations](OPERATIONS.md).

## Approved release and configuration

The user applied reviewed sync `exe-dc1svaajnfac739n3sn0` of Blueprint `exs-dc1s8hutlv9c73cvmplg` in My Workspace (`tea-cundai9opnds73d530i0`). It created `docklane-web-6rpd`, `docklane-api-6rpd` and their shared environment group. Render confirms the API plan is `free`; the frontend is a static site. The API uses source revision `1f06786413f9240cf48e95ad59185078c87a8842`; the frontend uses `861a69cedcbbb6712e3238b72c038841ec8ecc91` with the verified demo-label update. Automatic Blueprint sync and service Git deployment are disabled. The Blueprint's `paused` status represents automatic sync being off.

The approved free setup is already applied. Future infrastructure changes need review against the same ₹0 constraint; no paid resources or billing updates are authorized.

Assigned API/Auth URLs, exact frontend/checkout origins, the demo database guard and Stripe test credentials are configured privately. Initial builds failed until these manual settings were supplied; the environment updates triggered successful deployments. Check for an existing deploy after an environment update before requesting another. Free APIs lack paid pre-deploy hooks, so `deploy:start:free-api` validates the environment and applies direct migrations before listening. Startup never runs a seed/reset.

The deployed `https://docklane-api-6rpd.onrender.com/api/v1/webhooks/stripe` destination is registered in the existing Stripe sandbox with its own signing secret. The exact frontend origin is trusted by demo Auth. Rebuild the frontend when its `VITE_*` URLs change. The `/welcome` rewrites precede the SPA fallback.

For optional maintenance, configure repository variable `DOCKLANE_DEMO_DATABASE_HOST` with the approved direct demo host, and private Actions secrets `DOCKLANE_DEMO_DATABASE_URL` (direct connection), `DOCKLANE_DEMO_STRIPE_SECRET_KEY`, and `DOCKLANE_DEMO_STRIPE_WEBHOOK_SECRET`. Enable the activation variable only after review. Its target guard refuses the original development compute. Use the standard Ubuntu runner.

## Completion evidence

Public product/sign-in routes, readiness, all three roles' login/reload/permissions/logout and user-authorized inbox/password recovery passed. Real sandbox checkout, signed webhook confirmation, packing/shipment, partial/full test refunds and explicit return/restocking also passed. A real API redeploy preserved its active session, all 24 stock balances, both test orders and the pending expiry job. The unpaid order then expired at its normal 30-minute deadline with one stock release, completed recovery work and zero ledger/reservation mismatches. Phase 9 is complete; [the release record](PHASE_9.md) distinguishes hosted results, CI coverage and free-host limitations.

Sources checked on 23 November 2026: [Render free hosting](https://render.com/docs/free) and [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
