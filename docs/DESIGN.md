# Docklane design direction

Status: Phases 1-8 implemented, followed by a focused visual and motion refresh. The connected briefing includes explainable metrics, attention queues, warehouse/date filters, personal saved views, and role-scoped keyboard search. The public product page at /welcome uses real product screenshots, an interactive fulfillment story, an illustrative concurrency proof, and system light/dark themes. See [Phase 8](PHASE_8.md) for the verified application foundation.

## Design read

A modern operations application for merchants and warehouse teams, with a polished, energetic visual language. Order movement provides the recurring visual idea across the identity, product, and marketing page.

The workspace prioritizes clear information and fast interaction. The landing page has more room for expressive composition and narrative animation.

## Visual and motion refresh

The audit found a consistent Geist type system, readable navy/mist/lime tokens, working keyboard navigation, and a sound page hierarchy. The main opportunities were the static hero screenshot, a fulfillment illustration that could not be explored by step, and limited relationship between the prototype pipeline and the connected briefing. The refresh preserves routes, navigation labels, identity, forms, and authoritative quantities.

The public page uses design variance 6, motion intensity 6, and visual density 4. Its existing React, Radix, CSS, and Motion foundation stays in place. The operations UI follows the existing product design system, with lower motion intensity of 3. Marketing composition rules apply to the public page.

- The hero switches between authentic Overview, Inventory, and Orders screenshots. Keyboard-operable tabs include a direct link to each sample view. A small pointer tilt on devices with a mouse communicates that the preview is interactive. The initial image renders immediately; view transitions start after a user switches tabs.
- The order story explains reservation, verified payment, packing, and shipment through selectable steps. An optional Play journey sequence stops at shipment, pauses out of view or in a hidden tab, and is disabled by reduced-motion preference. Illustrative stock quantities remain distinct from saved workspace data.
- Both overviews use a shared fulfillment board. Counts come directly from their existing sources, and each lane opens its filtered orders. The connected board respects warehouse and date filters; it does not derive a misleading total from overlapping queues.
- Active navigation moves between destinations with a short spring transition. Metric, queue, and button feedback uses transforms and color. Stock counts and payment amounts never count up or interpolate.
- Transforms and opacity carry movement. Mobile layouts keep touch targets and collapse the journey and fulfillment queues. Reduced-motion users can navigate every step without animation or automatic playback.

The public page imports Radix Tabs directly and separates its shared primitives from workspace controls. This changes the initially required UI-control code from approximately 50 KB gzip to 10 KB gzip. The direct dependency uses the already-resolved Tabs version, 1.2.1.

Verification passed the 15 existing public/prototype browser cases, one connected development dashboard regression, and 13 focused interaction checks. These cover keyboard preview selection, stock-state illustrations, play/pause, stopping at shipment, offscreen playback, changing reduced-motion preferences, and preserving warehouse filters. Connected desktop accessibility/mobile layout, ordinary/reduced-motion hydration, and styled no-JavaScript content also passed. Type checking, production build, lint, and formatting were verified.

A local Lighthouse 12.8.2 run after the visual/motion refresh, before the complete workspace theme update, measured performance 89, accessibility 100, best practices 100, and SEO 92. Largest contentful paint was 3.3 seconds, total blocking time 90 milliseconds, and cumulative layout shift 0. These are single local diagnostics; scores vary with the device and runtime conditions.

Dependency follow-up: the three high findings reported on 20 November 2026 through Prisma 7.10.1 / Effect 3.20.0 ([GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw)) are resolved in Phase 9 preparation. The shared Prisma CLI now belongs to root tooling, where a scoped override selects compatible Effect 3.22.1. A fresh Linux Node 22.23.5 install, valid dependency tree, complete module loading, Prisma generation, backend/frontend deployment builds, domain checks, and a full zero-finding audit passed. Prisma remains on stable 7.10.1; see [Phase 9 verification](PHASE_9.md).

## Brand

- Name: Docklane.
- Tagline: Every order, moving forward.
- Character: confident, precise, approachable, and active.
- Identity: a clean Docklane wordmark with a lime stop, plus a compact lane-inspired mark implemented as an SVG favicon and navigation symbol.
- Copy: direct verbs and specific outcomes, such as "Reserve stock", "Mark packed", and "Refund pending".

## Visual tokens

These tokens are implemented in the Phase 1 workspace. Adjust them only when visual inspection or accessibility checks justify the change, then update all affected components together. Muted text was darkened to `#526173` during contrast verification.

| Token         | Value     | Application                                        |
| ------------- | --------- | -------------------------------------------------- |
| Ink           | `#101D2C` | Navigation, primary text, dark controls            |
| Mist          | `#F4F6F8` | Workspace background                               |
| Surface       | `#FFFFFF` | Tables, drawers, forms                             |
| Electric lime | `#B9F36B` | Primary actions with ink text, selected highlights |
| Muted text    | `#526173` | Supporting information                             |
| Border        | `#D9E0E7` | Dividers and control boundaries                    |
| Success       | `#216E46` | Success text and icons                             |
| Warning       | `#855A00` | Attention text and icons                           |
| Error         | `#B42318` | Errors and destructive outcomes                    |

Status colors communicate meaning and always have text or icons alongside them. Electric lime remains the brand accent. Use an ink focus ring on light surfaces and a lime focus ring on dark surfaces.

- Typeface: self-hosted Geist Sans; Geist Mono for SKUs, order identifiers, and technical quantities where useful.
- Data: tabular numerals for aligned prices and quantities.
- Body text: generally 14-16 px, with comfortably readable line height.
- Page headings: generally 28-36 px in the workspace, scaled to the viewport.
- Spacing: 4 px base scale, with 8/12/16/24/32 px steps.
- Shapes: controls at 8 px, panels at 14 px, status badges as pills.
- Elevation: restrained; use a subtle shadow for overlays and drawers, separators for ordinary grouping.
- Icons: one Phosphor family with consistent weights and sizes.

The navy navigation remains a signature brand surface. The complete workspace supports light, dark, and device-following themes, including connected staff/customer screens and sign-in. A shared theme control appears in page headers; Settings and My account provide explicit appearance choices. The preference persists across navigation and reloads, synchronizes across tabs, and follows device changes in System mode. Storage restrictions still allow theme changes for the current visit.

Semantic colors cover surfaces, text, borders, focus, status feedback, inventory bars, chart tooltips, native fields, popup menus, drawers, and notifications. Lime actions retain dark text in both modes. Product imagery keeps its original colors. The public preview uses actual screenshots captured in both themes; regenerate them with `node scripts/capture-theme-previews.mjs` while the local app is running. An early head script applies the stored preference before React renders; static public content follows device colors when JavaScript is unavailable.

Theme verification passed 20 production browser cases, covering the existing workspace flows, responsive landing page, persisted choices, portaled controls, device changes, restricted storage, cross-tab synchronization, and dark order details. Automated scans reviewed public/sample/sign-in screens and all connected staff/customer main pages in both palettes; the connected inventory badge was corrected and rechecked. Mobile checks found no page overflow. Production hydration, saved dark colors before React loads, and static device-dark content without JavaScript passed. Web/tooling type checks, the production build, lint, and formatting also passed.

## Navigation and screen architecture

Prototype navigation: Overview, Inventory, Warehouses, Orders, Payments, Activity, Settings. Connected staff navigation: Overview, Products, Inventory, Warehouses, Orders, People & access (Admin), My account. Customer navigation: Collection, My bag (with item count), My orders, My account.

The top bar contains the page context, warehouse filter when relevant, global search, and account controls. Every visible navigation destination must have useful content or a clear planned-feature state during the prototype, and a working destination before launch.

Customer surfaces: catalog, product detail when useful, cart, checkout, order history, order detail.

Phase 4 uses an editorial heading, product-led bag rows, and a quiet sage order-summary panel. Checkout has explicit Bag, Delivery, and Review/reserve steps. Field labels remain stable when validation errors appear; descriptions carry the error messages. The exact submitted request survives a lost response/reload, and its recovery view keeps the original command distinct from later bag/price changes. Mobile stacks the same information with full-width primary actions. Ordering motion remains restrained and respects reduced-motion preferences.

Phase 5 extends the sage summary into a payment panel with an explicit reserve/payment/confirmation lane, the stock deadline, current saved outcomes, and bounded refresh. Expired and late-payment refund states keep the order closed and offer a path back to the collection. Background tasks use readable status labels, filters, counts, and an Admin retry dialog with a reason.

The customer navigation uses shopping language. Detailed warehouse controls belong to the staff workspace.

## Three signature views

### Operations overview

- Lead with a useful daily briefing and a prominent attention queue.
- Show operational metrics in a compact horizontal band, with their definitions available.
- Give fulfillment progress the most visual emphasis: awaiting payment, ready to pack, packed, shipped.
- Place warehouse activity alongside the briefing at wide widths; stack it below at smaller widths.
- Show recent operational activity with readable actors, actions, and timestamps.
- Make each actionable metric open the corresponding filtered view.

### Inventory workspace

- Use a readable table with thumbnails, product/SKU, warehouse, on-hand, reserved, available, and reorder threshold.
- Make search, warehouse filters, sorting, and clear-all work together.
- Represent available and reserved quantities in a compact proportional visual with exact numeric labels.
- Open a side panel for stock history and authorized adjustments without losing table context.
- Add server pagination when connected to the API; retain filter state in the URL.
- Introduce saved views and permitted bulk actions during the UX completion phase.

### Order-detail panel

- Preserve the list's filters, scroll position, and selected order when opening details.
- Present order, payment, and fulfillment statuses separately.
- Use a readable timeline for reservation, payment, packing, shipment, cancellation, and refund events.
- Include line items, delivery address snapshot, totals, and stock allocation.
- Keep the next permitted action visible, with explanations when unavailable.
- Use a full-page detail view on small screens or on direct links.

## Warehouse explorer

A schematic warehouse diagram gives users a quick way to compare sites. Clicking a site filters or opens its stock and activity. The same information must be available in a keyboard-accessible list.

The first release models warehouses as sites. Bin-level layouts, location maps, and warehouse transfers belong to later releases. The diagram must match modeled data.

## Motion system

| Interaction             | Behavior                                                          | Purpose                         |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------- |
| Button hover and press  | Short color transition and restrained press feedback              | Confirm responsiveness          |
| Drawer opening          | Smooth translate/fade, approximately 220-300 ms                   | Preserve list-to-detail context |
| Filter changes          | Stable layout and a brief loading state when fetching             | Explain changing results        |
| Confirmed stock updates | Brief highlight on the changed number or row                      | Make the result visible         |
| Order status changes    | Transition the relevant timeline stage after server confirmation  | Explain progress                |
| Toasts                  | Short enter/exit transition with actionable text                  | Confirm outcomes                |
| Loading                 | Stable skeletons, without perpetual distracting motion            | Preserve hierarchy              |
| Landing page            | Selectable fulfillment story, optional playback, and preview tabs | Explain the product story       |

Operational motion is moderate and finishes quickly. Larger landing-page animations must fit the narrative and remain responsive.

- Prefer Motion from `motion/react` for component transitions.
- Use CSS for simple hover, press, and focus transitions.
- Use transforms and opacity for movement.
- Respect `prefers-reduced-motion`; preserve all information and feedback when movement is removed.
- Inventory quantities and payment states update from authoritative server results.
- Avoid animated rearrangement of table rows while a user is selecting or editing them.
- Announce asynchronous outcomes accessibly without repeatedly announcing unchanged data.

## Interaction and responsive requirements

- Global command menu with `Ctrl+K` / `Cmd+K`, plus a visible search button.
- Keyboard-operable navigation, filters, dialogs, and drawers.
- Focus returns to the invoking control after a drawer closes.
- Forms have explicit labels, useful validation, and loading/error/success states.
- Destructive operations require a specific confirmation in the application.
- Preserve form entries after recoverable errors.
- Empty states explain what is missing and offer an appropriate next action.
- Distinguish insufficient stock, stale data, permission errors, payment failure, and network failure.
- Test layouts at 390, 768, 1366, and 1440 px widths.
- Small screens use compact navigation and full-width details; preserve access to essential table fields.
- Aim for at least 44 px touch targets for primary mobile controls.
- Verify WCAG AA contrast, visible focus, and readable status distinctions.
- Avoid horizontal page overflow; table scrolling may be contained and explicitly usable.

## Marketing page

Build after working product screens exist so the page can use authentic product previews.

Proposed narrative: clear promise and demo entry, fulfillment story, inventory correctness explained visually, operations preview, and a final demo invitation. Use varied compositions with a single palette and a readable hero on a small laptop.

Marketing content must describe implemented behavior. Demo data is identified as demo data, and customer logos, testimonials, or usage statistics are included only if real.

## Design completion checks

Phase 1 satisfies the workspace checks below. Marketing and API-authoritative updates will be verified in their implementation phases. Automated scans complement the keyboard and visual checks; they do not establish full accessibility conformance.

- The overview, inventory, and order-detail views share the same typography, spacing, color, and shape rules.
- Primary interactions work with mouse, keyboard, and touch.
- Loading, empty, error, disabled, and success states are designed and exercised.
- Motion serves navigation, feedback, or explanation and has a reduced-motion equivalent.
- The workspace remains clear at 1366 x 768, with important actions visible.
- The landing page uses verified product behavior and real project screenshots.
