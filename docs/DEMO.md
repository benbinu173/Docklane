# Docklane demo and walkthrough

Open the [live product page](https://docklane-web-6rpd.onrender.com/welcome) or [sample workspace](https://docklane-web-6rpd.onrender.com). Connected [sign-in](https://docklane-web-6rpd.onrender.com/auth/sign-in) uses the isolated demo environment. Staff tools are under `/workspace`, customer browsing under `/account/catalog`, and customer orders under `/account/orders`. Fresh reviewer credentials are stored privately in `.local/release/accounts.json`; self-registration creates a Customer account. The free API can take about one minute to wake after idle. Public sample data and its concurrency animation are illustrative; the [PostgreSQL proof](CONCURRENCY_PROOF.md) is the correctness evidence.

## Three-minute guided review

1. **Product and appearance — 30 seconds.** Open `/welcome`, switch Light/Dark/System, inspect the real product previews, and explore the sample overview. Show the animated fulfillment board and reduced-motion support. On a phone, open navigation and inspect an order drawer.
2. **Customer purchase — 60 seconds, after API wake.** Sign up or use a privately supplied demo Customer account. Browse `/account/catalog`, add an item, open `/account/cart`, enter a clearly synthetic delivery address, and reserve the order. Show its stock hold before checkout. Complete Stripe test Checkout with `4242 4242 4242 4242`, a future expiry and CVC `123`. Wait for authoritative confirmation; a success redirect alone is insufficient.
3. **Staff fulfillment — 45 seconds.** In a separate browser session, use a privately supplied Operator account. Find the saved order under `/workspace/orders`, pack it, and record a sample carrier/reference when shipping. Open inventory history: shipment decreases physical and reserved stock together.
4. **Admin recovery — 45 seconds.** With the private Admin account, show a bounded test refund and receive/restock a return. Explain that refund alone does not change stock. Inspect audit/attention views. Demonstrate the fifty-request proof separately against the dedicated local test database.

For a recorded screen tour, `npm run capture:release` creates eight current desktop/mobile light/dark screenshots and a short sample walkthrough at `.local/release/docklane-walkthrough.webm`. Run it with the local production preview on port 4173. The clip demonstrates public/sample UI only; record the connected purchase/fulfillment after hosted checks pass. Avoid including passwords, dashboard secrets or real delivery information in recordings.

## Role boundaries

| Visitor        | Access                                                                            |
| -------------- | --------------------------------------------------------------------------------- |
| Public visitor | Product page and explicit sample workspace; no connected staff mutation access    |
| Customer       | Catalog, own bag/orders, test checkout and eligible customer actions              |
| Operator       | Stock and ordinary operational fulfillment; no role grants or Admin-only refunds  |
| Admin          | Staff access management, protected refunds, operational recovery and audit review |

Share staff credentials privately and rotate them after external reviews. Self-registration grants Customer only. Hosted account recovery passed with a user-authorized deliverable email on 23 November 2026, including reset/sign-in and rejection of the previous password and session. Generated reviewer `.test` addresses are for sign-in demonstrations and cannot receive recovery emails.

## Current release screenshots

| Screen          | Desktop light                                    | Desktop dark                                    | Mobile light                                    | Mobile dark                                    |
| --------------- | ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Product page    | [View](previews/release-landing-light-1366.png)  | [View](previews/release-landing-dark-1366.png)  | [View](previews/release-landing-light-390.png)  | [View](previews/release-landing-dark-390.png)  |
| Sample overview | [View](previews/release-overview-light-1366.png) | [View](previews/release-overview-dark-1366.png) | [View](previews/release-overview-light-390.png) | [View](previews/release-overview-dark-390.png) |

Captured from the local production build on 20 November 2026. The sample walkthrough remains in the ignored `.local/release/docklane-walkthrough.webm` for review/export; it does not show a connected purchase.

## Hosted connected order previews

The following views show the saved hosted sandbox order DL-10001 after shipment, full test refund and explicit return/restock. They use synthetic delivery/tracking details and exclude account emails.

| View           | Desktop light                                   | Desktop dark                                   | Mobile light                                   | Mobile dark                                   |
| -------------- | ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Staff order    | [View](previews/phase9-staff-light-1366.png)    | [View](previews/phase9-staff-dark-1366.png)    | [View](previews/phase9-staff-light-390.png)    | [View](previews/phase9-staff-dark-390.png)    |
| Customer order | [View](previews/phase9-customer-light-1366.png) | [View](previews/phase9-customer-dark-1366.png) | [View](previews/phase9-customer-light-390.png) | [View](previews/phase9-customer-dark-390.png) |

Captured from the live demo on 23 November 2026. Private connected walkthrough clips are at `.local/release/docklane-hosted-staff.webm` and `.local/release/docklane-hosted-customer.webm`. They show saved order/payment/refund/return history, responsive themes and sign-out; they exclude login and Stripe card entry. The actual hosted purchase and refund checks are recorded in [Phase 9](PHASE_9.md).
