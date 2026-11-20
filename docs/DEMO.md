# Docklane demo and walkthrough

The public sample workspace is available locally at `/`; `/welcome` introduces the product. Connected staff tools are under `/app`, customer browsing under `/shop`, and sign-in under `/auth/sign-in`. A hosted link will be added after deployment verification. Public sample data and its concurrency animation are explicitly illustrative; the [PostgreSQL proof](CONCURRENCY_PROOF.md) is the correctness evidence.

## Three-minute guided review

1. **Product and appearance — 30 seconds.** Open `/welcome`, switch Light/Dark/System, inspect the real product previews, and explore the sample overview. Show the animated fulfillment board and reduced-motion support. On a phone, open navigation and inspect an order drawer.
2. **Customer purchase — 60 seconds, after hosted setup.** Sign up or use a privately supplied demo Customer account. Browse `/shop`, add an item, enter a clearly synthetic delivery address, and submit. Show the order's stock hold before checkout. Complete Stripe test Checkout with `4242 4242 4242 4242`, a future expiry and CVC `123`. Wait for authoritative confirmation; a success redirect alone is insufficient.
3. **Staff fulfillment — 45 seconds.** In a separate browser session, use a privately supplied Operator account. Find the saved order under `/app/orders`, pack it, and record a sample carrier/reference when shipping. Open inventory history: shipment decreases physical and reserved stock together.
4. **Admin recovery — 45 seconds.** With the private Admin account, show a bounded test refund and receive/restock a return. Explain that refund alone does not change stock. Inspect audit/attention views. Demonstrate the fifty-request proof separately against the dedicated local test database.

For a recorded screen tour, `npm run capture:release` creates eight current desktop/mobile light/dark screenshots and a short sample walkthrough at `.local/release/docklane-walkthrough.webm`. Run it with the local production preview on port 4173. The clip demonstrates public/sample UI only; record the connected purchase/fulfillment after hosted checks pass. Avoid including passwords, dashboard secrets or real delivery information in recordings.

## Role boundaries

| Visitor        | Access                                                                            |
| -------------- | --------------------------------------------------------------------------------- |
| Public visitor | Product page and explicit sample workspace; no connected staff mutation access    |
| Customer       | Catalog, own bag/orders, test checkout and eligible customer actions              |
| Operator       | Stock and ordinary operational fulfillment; no role grants or Admin-only refunds  |
| Admin          | Staff access management, protected refunds, operational recovery and audit review |

Share staff credentials privately and rotate them after external reviews. Self-registration grants Customer only. Account recovery must be verified with a real deliverable email on the deployed demo; generated `.test` addresses do not demonstrate delivery.

## Current release screenshots

| Screen          | Desktop light                                    | Desktop dark                                    | Mobile light                                    | Mobile dark                                    |
| --------------- | ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Product page    | [View](previews/release-landing-light-1366.png)  | [View](previews/release-landing-dark-1366.png)  | [View](previews/release-landing-light-390.png)  | [View](previews/release-landing-dark-390.png)  |
| Sample overview | [View](previews/release-overview-light-1366.png) | [View](previews/release-overview-dark-1366.png) | [View](previews/release-overview-light-390.png) | [View](previews/release-overview-dark-390.png) |

Captured from the local production build on 20 November 2026. The sample walkthrough remains in the ignored `.local/release/docklane-walkthrough.webm` for review/export; it does not show a connected purchase.
