# Docklane operations

Development, integration, and public-demo environments have separate data and credentials. `.env.local` remains development; `.env.demo.local` is the reviewed demo environment. Never point concurrency scripts, integration tests, or development seeds at the demo.

## Builds and migrations

Use Node 22 (at least 22.12) and `npm ci --include=dev` during deployment builds, so production mode still installs Prisma and TypeScript tooling. `npm run deploy:build:backend` generates Prisma and compiles shared packages, API, and worker. `npm run deploy:build:web` validates HTTPS frontend variables, compiles contracts, and builds/prerenders the web client. `npm run build` remains the local/CI full build.

Run migrations through the direct connection before the API starts. The free API startup command validates configuration and applies migrations before listening. Review migrations for compatibility with the previous deployed code; a failed deployment may leave an applied migration. Avoid running worker processing before the initial schema is ready. Demo Auth preparation uses `scripts/demo-auth.mjs` with its registered seed origin and a private checkpoint; its sessions are closed after verification. Database bootstrap follows migrations and precedes public sign-ins. Both use the demo target guards and require an explicitly enabled bootstrap flag.

## Recovery

| Symptom                      | Action and evidence                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| API fails readiness          | Check database availability and migrations, then retry readiness; never expose raw connection errors             |
| Redis unavailable/full       | Restore the persistent store, inspect memory and `noeviction`; database sweeps retain expiry/recovery work       |
| Worker restarted             | Confirm pending outbox work, expired leases, and overdue reservations reconcile without repeated stock movements |
| Ambiguous Stripe response    | Inspect the durable operation and provider idempotency reference; reconcile before creating a new payment/refund |
| Refund pending               | Inspect failed/reconciliation work as Admin; a monetary refund does not automatically restock a return           |
| Sign-in failure after deploy | Confirm chosen origin, demo Auth/JWKS branch, active provider session, and application profile                   |

Use safe structured error codes and correlation IDs. Do not paste provider payloads, session tokens, account files, addresses, or database credentials into public issues.

## Backup and restore

`npm run backup:rehearse` uses Docker's PostgreSQL tools to dump **only the isolated local `docklane_test` public schema** and restore into a newly created `docklane_restore_<random>` database. It compares every public table's count/content digest and sequence state, checks stock invariants, and confirms the source was unchanged. It refuses cloud targets, the development database, empty fixture data, and a nonstandard Compose test port. Archives and reports stay in `.local/release/`; the restored local database remains available for inspection. This verifies a database procedure, not a hosted disaster-recovery objective.

For a real demo backup, use PostgreSQL client tools matching or newer than the server and the **direct** Neon connection. Keep passwords in process environment or a protected `.pgpass`, never command arguments. Use `pg_dump --format=custom --no-owner --no-acl --schema=public` into a protected archive, then `pg_restore --exit-on-error --no-owner --no-acl` into a fresh isolated target. Freeze writes or compare a consistent snapshot for verification. Check counts/digests, constraints, sequence state, migrations, active reservations and their movements, and order/payment/refund relationships. Do not restore into a populated environment as an ordinary reset.

Auth is provider-owned and excluded from an application-only dump. Recovery requires a deliberate identity mapping/session invalidation strategy. After a real restore, reconcile payment/refund records with Stripe before exposing writes or starting the worker: an older database cannot undo external charges or refunds. Confirm provider-side backup/restore support before claiming complete hosted recovery.

## Restricted demo reset

The default reset is **rotation to a fresh isolated demo branch**, followed by migrations, fresh demo identities and the guarded bootstrap. It does not erase live order/audit history or share development credentials. Update API, worker, frontend Auth URL, trusted origins and queue namespace together; verify the new branch before directing visitors to it. Stop the old worker so it cannot keep processing its previous environment. Retain the old branch for inspection until explicit cleanup is approved.

An in-place truncate/reset is deliberately absent. Re-running bootstrap refuses existing data. Public visitors can explore the sample workspace; staff access to the connected demo is shared privately for a guided review.

## Rollback

Redeploy a previously verified code revision only after checking its compatibility with applied migrations. Keep workers aligned with API/schema versions. Do not treat a database restore as ordinary code rollback: it can lose post-backup orders while external payment state persists. Record the revision, migration state, backup target, and recovery outcomes when carrying out a reviewed rollback.

## Free hosted recovery

The free API uses `BACKGROUND_MODE=database` to process durable work while awake. Its one-minute loop shares PostgreSQL leases with optional hourly GitHub maintenance. Maintenance starts disabled; three batches and a five-minute timeout bound each run. API sleep and delayed schedules can postpone expiry/payment/refund processing. Restart recovery preserves stock correctness and provider idempotency. Local `npm run dev` still runs the full Redis/BullMQ worker. See [free deployment setup](DEPLOYMENT.md).
