# Phase 7: Connected operations and product experience

Status: complete. Version 0.7.0.

## Delivered

The staff overview now uses one repeatable-read PostgreSQL snapshot for stock, warehouse totals, order queues, test-payment totals, recent orders, and actor-stamped activity. Stock metrics and order queues open their corresponding saved lists. The connected application continues to use authoritative API data; the original sample adapter remains separately available on its existing preview routes.

The overview has warehouse and Indian-calendar date filters. Order lists add separate payment, fulfillment, warehouse, queue, and inclusive date filters. Filters remain in the URL, and order detail links carry a validated relative return path so returning preserves the list's filters and pagination. Fulfillment and warehouse fields are visible in staff order tables.

Inventory adds a combined needs-review view for low and unavailable stock. Its existing threshold editor, movement history, archive handling, warehouse explorer, and reviewed adjustments remain connected.

Inventory and order lists support eight personal saved views per account and surface in the current browser. Views preserve supported filters and sorting while omitting the selected record and pagination. A named save replaces an existing view with the same name. Removing views and copying links are supported. Storage and clipboard failures show recovery guidance. Personal views are browser-local, rather than shared team preferences.

Quick search opens from a visible control or Ctrl+K/Cmd+K. It offers role-appropriate navigation and debounced API results for orders, products, and staff warehouses, limited to six per category. Customers can search their own orders and the active collection. Arrow keys and Enter select a destination; Escape closes the dialog and restores focus.

New dashboard/order/inventory background reads refresh every 30 seconds for the first two minutes while visible. Refresh pauses while an input, select, textarea, editable element, or dialog is active. Manual refresh remains available on the overview. Existing payment reconciliation continues its more frequent bounded refresh. Confirmed order actions invalidate connected, stock, and checkout query groups; stock changes invalidate stock and overview results. Forms and URL filters survive recoverable reads.

## Public product page

Open `/welcome` for the product page. Existing preview routes remain available. The page contains a two-line brand promise, actual Docklane screenshots, a scroll-linked reserve/payment/pack/ship journey, an explicitly illustrative version of the verified ten-unit/fifty-request proof, customer checkout previews, and working demo/sign-in/signup links.

The illustration does not issue API mutations or place orders. Marketing copy describes implemented behavior and identifies sample data and Stripe test money. No invented customer logos, testimonials, adoption statistics, or performance promises are included.

The page uses Docklane's self-hosted Geist fonts, Phosphor icons, ink/mist/lime palette, eight-pixel controls and fourteen-pixel panels. The layout uses an asymmetric hero, a full-width journey, offset product previews, an interactive correctness section, and a final invitation. Motion explains entry, fulfillment progression, and user feedback. Reduced motion preserves the complete story. System light/dark preferences and a theme control are supported.

The production build statically renders `/welcome` into `apps/web/dist/welcome.html`, includes the product stylesheet from Vite's manifest, and hydrates the same React page for interactive controls. The hero and product story remain readable without JavaScript. Both reduced-motion and ordinary hydration pass without React mismatch errors. Below-fold reveals use CSS scroll timelines where supported; other browsers retain visible content. The prototype and connected application load their own providers and UI code only on their routes.

Vite preview serves `/welcome` from this generated file. A future static host must map `/welcome` to `/welcome.html` **before** its general single-page fallback, and serve `/`, `/auth/*`, `/workspace/*`, and `/account/*` using `index.html`. The development Vite server continues to render the product page on the client. Static rendering contains only public product copy and screenshots; protected application data is never embedded.

## Metric definitions

| Metric                 | Definition                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Date range             | Orders created from the start day's midnight through the entire end day in Asia/Kolkata; optional open bounds           |
| Open orders            | Awaiting payment or confirmed orders in that cohort                                                                     |
| Ready to pack          | Confirmed, captured/partially-refunded, unfulfilled orders                                                              |
| Ready to ship          | Confirmed, captured/partially-refunded, packed orders                                                                   |
| Refunds in progress    | Orders with refund-pending payment state                                                                                |
| Returns to inspect     | Orders with any received quantity greater than its restocked quantity                                                   |
| Available and reserved | Current balances for active products at active warehouses; date filters do not create historical inventory snapshots    |
| Low stock              | Positive available quantity at or below its threshold                                                                   |
| Out of stock           | Zero available quantity                                                                                                 |
| Captured test money    | Saved payment amounts in captured, refund-pending, partially-refunded, or refunded states for the selected order cohort |
| Successful refunds     | Succeeded refund attempts for those orders, regardless of the refund event date                                         |
| Net captured           | Captured amounts minus succeeded refunds; pending refunds remain until confirmed                                        |
| Activity               | Recent audit events by event date, optionally scoped to orders, balances, and the selected warehouse                    |

Queue counts can overlap. The dashboard includes an expandable explanation of these definitions. Historic orders still appear when their warehouse is archived; current inventory totals exclude archived products/sites. Unknown warehouse filters produce an empty scoped view rather than silently broadening the results.

## Verification

Eight new PostgreSQL/API checks cover stock reconciliation and archive exclusion; both edges of an Indian calendar day; queue/list agreement; simultaneous payment/fulfillment filters; captured and pending/succeeded/failed refund totals; partially restocked return quantities; customer search ownership; bounded and scoped activity; and invalid date, range, queue, and search requests. The complete local API suite passed **88 checks**. Domain checks passed **8 checks**.

Seven connected browser checks cover queue links, direct-link context, personal view persistence/removal, keyboard search and focus restoration, failed-read recovery without losing filters, customer navigation, responsive accessibility, and automatic refresh. The clock-controlled refresh check verifies pausing during input/dialogs, resuming afterward, stopping at two minutes, and retaining manual refresh. Focus, visibility, and dialog changes now update the refresh schedule, so an already scheduled read is cancelled while input is active.

Three public landing checks cover light/dark themes, real image loading, no page overflow, anchors, illustrative controls, and demo entry. All twelve original public preview checks also pass, including keyboard order search and deep links. Keyboard-only entry waits for the lazy-loaded workspace to render before sending the shortcut. Accessibility and layout checks use 390, 768, 1366, and 1440 px widths.

Final verification uses the production frontend after package builds finish. All **22 browser checks** passed, including focused reruns of the refresh and original keyboard-menu checks after test-timing fixes. With the eight domain and 88 PostgreSQL/API checks, this phase passed **118 distinct checks**. Formatting, lint, type checking, and builds pass. The static product page was additionally checked with JavaScript disabled and with ordinary/reduced-motion hydration; no runtime or hydration mismatch errors were recorded. Automated scans supplement manual desktop/mobile screenshot review and keyboard checks; they do not establish full accessibility conformance.

A final read-only comparison confirmed all **81 development balances**, including their quantities and versions, and **DL-10023** are unchanged from the Phase 7 baseline. No migration, seed, inventory adjustment, refund, or live payment was performed. Private baseline/proof files remain in `.local`.

## Product-page performance

Measured on Windows with Node 22.16.0, the local Vite production preview, and Lighthouse 12.8.2 in mobile simulation: 150 ms RTT, roughly 1.6 Mbps throughput, and four-times CPU slowdown. Each column is one local run, rather than a hosted benchmark or a field-user measurement.

| Measurement              | Initial client-rendered page | Static page with isolated route bundles |
| ------------------------ | ---------------------------- | --------------------------------------- |
| Performance              | 77                           | 84                                      |
| Accessibility            | 100                          | 100                                     |
| Best practices           | 100                          | 100                                     |
| SEO                      | 92                           | 92                                      |
| Largest contentful paint | 4.4 s                        | 3.8 s                                   |
| Total blocking time      | 180 ms                       | 30 ms                                   |
| Cumulative layout shift  | 0                            | 0.021                                   |

The main entry script decreased from about 44 KB to 1.9 KB gzip; shared React/Motion dependencies still load separately. The four WebP previews total about 223 KB. The hero image is discoverable in the initial HTML and requests high priority. Static rendering removes the need to wait for React before displaying the product story.

The final mobile LCP remains above the 2.5-second good threshold. Lighthouse identifies stylesheet/render delays and a small font-swap layout shift; these are recorded for Phase 8's broader performance work. Accessibility scores supplement the responsive axe, keyboard, and screenshot checks; they do not establish full accessibility conformance. Reports stay in ignored `.local` files.

## Run and inspect

Reviewed previews: [overview desktop](previews/phase7-overview-1366.png), [overview mobile](previews/phase7-overview-390.png), [order filters desktop](previews/phase7-orders-1366.png), [order filters mobile](previews/phase7-orders-390.png), [landing light desktop](previews/phase7-landing-light-1366.png), [landing light mobile](previews/phase7-landing-light-390.png), [landing dark desktop](previews/phase7-landing-dark-1366.png), and [landing dark mobile](previews/phase7-landing-dark-390.png).

```sh
npm run dev
# Product page: http://127.0.0.1:5173/welcome
# Connected staff: http://127.0.0.1:5173/workspace

npm run test:integration
npm run test:auth -- --phase7
npm run test:e2e
```

No schema migration, development seed/reset, live payment, or deployment is part of this phase. The existing Neon development branch and original order data are preserved. Phase 8 covers the broader security, correctness, and performance release verification.
