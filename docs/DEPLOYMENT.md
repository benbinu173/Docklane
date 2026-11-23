# Deployment preparation

Status: the isolated Neon demo is initialized; the all-Render Blueprint exists, but its provider plan is awaiting workspace billing setup. No Render services or live demo URL have been created. The candidate [Render Blueprint](../infra/render.yaml) defines a static frontend, API, worker, and persistent Key Value queue. [Vercel configuration](../vercel.json) retains the originally planned frontend option.

## Hosting choice and costs

| Resource               | Candidate plan                        | Monthly baseline    |
| ---------------------- | ------------------------------------- | ------------------- |
| Render static frontend | Static site                           | $0                  |
| Render API             | `0.5c-512mb`, one instance            | $7                  |
| Render worker          | `0.5c-512mb`, one instance            | $7                  |
| Render Key Value       | `256mb`, journal/snapshot persistence | $10                 |
| Existing Neon project  | Current free plan, subject to quotas  | $0 within allowance |

The backend baseline is **$24/month**, excluding extra usage, tax, and workspace charges. Prices and plan IDs were checked against [Render pricing](https://render.com/pricing) and [Blueprint reference](https://render.com/docs/blueprint-spec) on 20 November 2026. Free Key Value has no persistence; a free sleeping API is a weaker option for an interactive demo, and background workers need paid compute. The connected Render account lists **My Workspace** (`tea-cundai9opnds73d530i0`); the user confirmed this workspace and selected all-Render hosting on 23 November 2026, for planning only.

Use Render for the frontend if a single connected provider is preferred. To retain Vercel, omit the static service from the reviewed Blueprint and import the repository into Vercel with its repository root as the project root. Set both frontend variables there. Select one frontend before provisioning services and origins.

## Isolated demo configuration

1. The `demo-phase-9` branch (`br-twilight-term-aorpkx3h`) was created on 23 November 2026 from the empty `main` branch in the existing `docklane` project. For another demo rotation, use the same empty-parent approach instead of copying `dev-phase-2`. The free account requires its default suspend settings. Do not copy development identities, orders, or balances.
2. Enable Managed Neon Auth on the demo branch's `docklane` database. Obtain its Auth/JWKS URLs and direct/pooled connections. Keep them in ignored `.env.demo.local`; keep `.env.local` pointing at development.
3. Copy [.env.demo.example](../.env.demo.example) to `.env.demo.local`. Set `DEMO_DATABASE_HOST` to the direct demo compute host. Fill the real assigned HTTPS origins when available. Auth and app data must use this same branch. Data/Auth bootstrap can run before hosting origins and Stripe keys are available; API deployment still requires them.
4. Create fresh demo Auth identities for Admin, Operator, and Customer using `node --env-file=.env.demo.local scripts/demo-auth.mjs` with `ALLOW_DEMO_BOOTSTRAP=true` and a registered `DEMO_AUTH_SEED_ORIGIN`. The script checkpoints random passwords privately before signup, recovers a lost response through sign-in, verifies each login and closes its sessions. It refuses an account file from another branch. Keep credentials private. Save `{ "authUrl": "the demo Auth base URL", "accounts": [{ "authSubject": "provider user ID", "email": "matching email", "role": "ADMIN" }] }` to `.local/release/accounts.json`, with all three roles represented. The bootstrap verifies each subject/email against the demo's `neon_auth.user`; it uses provider-owned names.
5. Migrate using `node --env-file=.env.demo.local scripts/database.mjs migrate`. With `ALLOW_DEMO_BOOTSTRAP=true`, review `node --env-file=.env.demo.local --import tsx scripts/demo-bootstrap.ts`, then run it with `--apply`. Disable the flag afterwards. The command creates catalog, warehouses, opening stock and staff profiles only. It refuses populated application tables and does not fabricate connected payment history.

The migration helper preserves explicitly supplied environment variables even though it also reads development dotenv defaults. Supply **both** database URLs from the demo environment. Runtime/deployment guards reject an inherited separate development Auth database.

## Review and launch

The Render tools require a confirmed workspace before Blueprint planning, and explicit approval of the actual reviewed plan before application. Cost acceptance or supplying secrets does not itself authorize deployment.

The initial Blueprint `exs-dc1s8hutlv9c73cvmplg` exists with zero resources and `autoSync: false`. Render returned `need_payment_info` before it could plan the paid services. In the [Render Dashboard](https://dashboard.render.com), select My Workspace, open Billing in the left pane, then complete Payment Method setup. Keep the current workspace plan; a plan upgrade is not required by this configuration. Retry `plan_blueprint` for the existing Blueprint afterwards. Billing setup enables planning and does not replace deployment approval. See [Render dashboard billing guidance](https://render.com/docs/render-dashboard#manage-billing).

Push the validated repository and `infra/render.yaml` first. Create the Blueprint with `existingResources: create_new` and `autoSync: false`. Review its proposed resources, costs, required manual values, and dashboard link. Do not approve a failed plan. All service automatic deploy triggers are off during preparation, so a Git push alone does not launch or change infrastructure.

Manual values are collected through the private environment file/provider dashboard, never chat: API pooled/direct URLs, demo host, Auth/JWKS URLs, exact web/checkout origins, Stripe test keys; frontend API/Auth URLs. The worker references the API's shared configuration and the queue's internal connection string. Environment groups contain nonsecret constants only.

Render assigns public domains during provisioning. `fromService.property: host` is a **private hostname**, not a public API URL; Blueprint values do not interpolate URLs. If assigned domains are unavailable in the initial plan, set final origins before the first successful startup and rebuild the frontend afterwards. Initial builds intentionally fail when required configuration is incomplete.

## Required hosted checks

Before calling Phase 9 complete:

- Add only the chosen frontend's HTTPS origin to demo Neon Auth trusted domains; configure recovery redirect and turn off demo localhost allowance after local verification. Test recovery with an actual deliverable email, including reset and restored login.
- Run `npm run deploy:check:api` in the API environment. Verify `/health/live` and `/health/ready`, migrations, persisted roles, and customer ownership after a restart.
- Register `${API_ORIGIN}/api/v1/webhooks/stripe` in the same Stripe sandbox as the demo test key. Subscribe to the events listed in [Phase 5](PHASE_5.md). Use this endpoint's signing secret, not the local Stripe CLI secret.
- Complete a test customer checkout, confirm it through verified provider processing, then pack and ship as staff. Verify repeated shipment consumes stock once. Exercise a test refund and explicit received return/restock.
- Verify expiry across worker restart, a late payment's compensation, signed webhook delivery/retry, and persistent queue recovery. Render background workers cannot use web-service health probes; check worker status/logs and its local health endpoint through a provider shell.
- Record assigned URLs and dated results in [Phase 9](PHASE_9.md). Rebuild the web client whenever `VITE_*` variables change; they are build-time values.

The `/welcome` and `/welcome/` rewrites must precede the SPA fallback so visitors receive the prerendered product page. Other direct links must load the application. Keep one API instance until shared rate-limit storage is implemented.
