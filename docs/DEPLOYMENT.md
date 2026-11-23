# Free demo deployment

Status: the demo database/Auth are initialized. Hosting is prepared for review with a **₹0 budget and no payment method**. [The Render Blueprint](../infra/render.yaml) defines only a free static frontend and a free API. The previous paid worker/queue proposal is superseded.

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

## Review and release

My Workspace (`tea-cundai9opnds73d530i0`) is already confirmed. Existing Blueprint `exs-dc1s8hutlv9c73cvmplg` has no resources and automatic sync disabled. Push the free-only file, then use `plan_blueprint` for that Blueprint. The former `need_payment_info` error applied to the paid proposal; billing setup is no longer the selected path.

Review the actual planned resources and $0 service plans. Render requires explicit approval of the reviewed plan before application. Confirming a free budget or supplying keys does not replace approval. No paid resources or billing updates are authorized.

Render assigns public domains during provisioning. Set the assigned API URL and demo Auth URL on the frontend; set exact frontend/checkout origins and test Stripe credentials on the API. Enter values privately. Free APIs lack paid pre-deploy hooks, so `deploy:start:free-api` validates the environment and applies direct migrations before listening. Startup never runs a seed/reset.

Register the deployed `/api/v1/webhooks/stripe` destination in the existing Stripe sandbox and use that endpoint's signing secret. Add the selected frontend origin to demo Auth. Rebuild the frontend when its `VITE_*` URLs change. The `/welcome` rewrites precede the SPA fallback.

For optional maintenance, configure repository variable `DOCKLANE_DEMO_DATABASE_HOST` with the approved direct demo host, and private Actions secrets `DOCKLANE_DEMO_DATABASE_URL` (direct connection), `DOCKLANE_DEMO_STRIPE_SECRET_KEY`, and `DOCKLANE_DEMO_STRIPE_WEBHOOK_SECRET`. Enable the activation variable only after review. Its target guard refuses the original development compute. Use the standard Ubuntu runner.

## Completion evidence

After approval, verify public direct links, Auth recovery with a deliverable email, test checkout/webhook confirmation, fulfillment/refund/return, API restart/wake and background recovery. Record delays and quotas accurately. Phase 9 remains in progress until hosted smoke checks pass; [the release record](PHASE_9.md) tracks them.

Sources checked on 23 November 2026: [Render free hosting](https://render.com/docs/free) and [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
