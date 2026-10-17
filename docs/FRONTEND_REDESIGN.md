# PostAtlas frontend redesign - design system and verification report

## What this change is (and is not)
A visual and navigation redesign built on the existing application. No database schema, API route, server action,
order state, payment, payout, monitoring or authorization logic was changed by the redesign. Backend files touched in this
delivery are limited to the earlier login/signup error fix (`src/lib/auth-errors.ts`, `src/lib/rate-limit.ts`,
`src/lib/actions/auth.ts`, optional SQL patch).

## Design system
All pages share one token layer, so every area (public, customer, publisher, admin) changes together.

| Token | Value | Use |
| --- | --- | --- |
| `navy` | #2D3E50 | Footer, admin sidebar, dark surfaces |
| `accent` | #FF7A59 | Primary buttons, active states (tinted `accentsoft` #FFF1ED) |
| `accenttext` | #C2410C | Coloured text and links (coral itself is never used for small text) |
| `paper` / `paperdim` / `mist` | #FFFFFF / #F5F8FA / #EEF2F6 | Cards / page background / chips and skeletons |
| `ink` / `inksoft` | #1F2937 / #5E6E83 | Primary / secondary text |
| `line` / `inputborder` | #E2E8F0 / #8493A8 | Dividers / form-field borders |
| `verdigris*`, `amber`, `redsig` | green / amber / red | Success, warning, error states only |

Legacy token names were kept (values changed) so the ~100 existing usages keep working. Fonts: Inter and JetBrains Mono
(loaded the same way as before). Component classes live in `src/app/globals.css`: `.btn`, `.btn-primary`, `.btn-danger`,
`.input`, `.label`, `.card`, `.table-wrap`, `.eyebrow`, `.skeleton`, status chips.

### Deliberate deviations from the supplied palette (accessibility)
* White text on #FF7A59 measures 2.57:1 (fails WCAG AA). Coral buttons therefore use dark text (`ink`, 5.72:1).
* Secondary text #64748B measured 4.46:1 on #F5F8FA and 4.23:1 on chips. It is rendered as #5E6E83 (>= 4.6:1 everywhere).
* Form-field borders need 3:1 (WCAG 1.4.11); #E2E8F0 is ~1.2:1, so inputs use #8493A8 (3.1:1). #E2E8F0 remains the divider colour.
`tests/ui-system.test.ts` recomputes these ratios from `tailwind.config.ts`, so they cannot silently regress.

## Shared components
New: `NavLinks` (active state, `aria-current`), `MobileAppMenu` (keyboard-operable, Escape closes and restores focus,
closes on navigation), `Breadcrumbs`, `Skeleton`, `ErrorState`, `src/lib/nav.ts`, `src/app/dashboard/error.tsx`.
Reworked: `AppShell` (workspace label: Customer / Publisher / Admin workspace), `PageHeader`, `EmptyState`, `NextStep`,
`StatusBadge`, `SiteHeader`, `MobileNav`, `HeaderAuth`, `SiteFooter`, loading and error pages, login/signup/reset pages.

## Pages
* **Terminology (important):** a *publisher* is an account that applies, is verified by an admin, lists websites and receives
  orders (`/for-publishers` explains it publicly, `/apply-publisher` is the application, `/publisher/*` is the workspace).
  Writing an article for the PostAtlas blog is a different thing: `/write-for-us` ("Write for Us"). They are never mixed in navigation.
* Homepage: new headline and CTAs (Explore Opportunities -> `/publishers`, Become a Publisher -> `/for-publishers`), a
  "Where do you want to start?" chooser (customer vs. site owner), the working free website check, accurate copy.
  No invented customers, ratings or numbers.
* `/for-publishers` (new): the six real steps from sign-up to payout, FAQ, and the commission read from `COMMISSION_BPS`.
* Publisher overview: a "Getting started" checklist and a plain-language line under each website's status.
  Customer overview: a short "How PostAtlas works" guide until the first order exists.
* Public navigation: Explore Opportunities, Free website check, For Publishers, How It Works, Pricing, Resources. Every link
  is verified by a test to resolve to a real page.
* Customer navigation: Overview, My Websites, Opportunities, Publishers, Orders, Placements, Backlink Monitoring, Settings.
* Every other page inherits the new look through the shared tokens and classes (including all admin and publisher pages).

## Convenience pass (marketplace, orders, detail page)
Inspired by common patterns on Airbnb/Booking-style search, Stripe and Shopify admin lists, and Linear views; implemented with
plain links and `<details>`, so nothing needs JavaScript and every state is shareable by URL.
* Marketplace (`/publishers`): search first, three everyday filters, authority/budget under "More filters", removable chips for
  applied filters, "Showing 1-20 of N", both prices on each card (guest post and link insertion), delivery time, plain-language
  DR explanation. Server-side filtering and the domain whitelist are unchanged.
* Publisher detail: sticky order card with prices, delivery and the real order/advice links; quality figures explained.
* Orders (customer and publisher): status tabs with counts (customer: Needs your action / In progress / Live and completed / Closed;
  publisher: Waiting for your answer / In progress / Verified and completed / Declined), an attention banner when something needs
  an answer, the primary button highlighted on rows that need action, and a compact card layout on mobile.
  Every status is in exactly one tab (tested). A publisher's tabs can only narrow, never widen, what they may see.
* Customer order page: a five-step progress tracker (Payment, Your article, Publisher, Published, Live and monitored) driven by the
  real status. A submitted URL counts as "Published", never as "Live and monitored" until verification succeeds; problem states
  show an attention marker; cancelled/declined orders show a plain message and a way to pick another publisher.
* New shared pieces: `HelpTip`, `FilterChips`, `FilterTabs`, `OrderProgress`, `src/lib/query-string.ts`, `src/lib/order-groups.ts`,
  `src/lib/order-progress.ts`.

## Final handover checklist (Windows PowerShell)
```powershell
Expand-Archive PostAtlas-Production-Frontend-Updated.zip -DestinationPath D:\      # use a drive with free space
cd D:\postatlas
Copy-Item .env.example .env.local                                                  # then fill in your real values
npm ci
npm run typecheck ; npm test ; npm run build ; npm audit --omit=dev
npm run dev                                                                        # http://localhost:3000
```
Manual walk-through before deploying: sign up and log in; add a website; open Publishers, filter, open a publisher, start an order;
sign in as a publisher and open Orders (tabs, Review); check `/for-publishers`, `/apply-publisher` and `/write-for-us` each go
where their names say. Supabase: run `supabase/PostAtlas_patch_auth_rate_limit.sql` only if the server log names the rate limiter.
Vercel: environment variables must match `.env.example`; none are added or renamed by this redesign.

## Not done (honest list)
* No page-by-page layout redesign of the dashboard Opportunities page, checkout, order detail timeline, publisher listings form or earnings
  screens. They are restyled through tokens only; their structure and behaviour are unchanged. These are the next stage.
* No administrator-controlled announcement banner (needs a new settings store and admin UI; not added without a backend change).
* No "featured opportunities" block on the homepage (marketing pages are deliberately cookie-free and statically cached;
  adding live inventory needs a decision about caching).
* No project lint script exists (`package.json` has none), so linting was not run.
* No browser-based responsive or accessibility testing was possible in the build environment. 320-1440px behaviour is
  designed in (flex/grid wrap, `min-w-0`, `overflow-x-auto` tables, `overflow-wrap:anywhere`) but not visually verified.

## Verification actually performed
Build environment for this delivery had no registry access, so dependencies could not be installed there.
* `node --test`: 308 of 309 pass. The one failure, `tests/db-payouts.test.ts`, cannot load `@electric-sql/pglite`
  because it was not installed in that environment.
* `tsc` (global, without React/Next/Node type packages): the only differences from the original upload are
  missing-module diagnostics for the new files; no new type-logic errors. This is NOT a substitute for `npm run typecheck`.
* NOT run in that environment: `npm run typecheck`, `npm run build`, `npm audit`. Run them locally (see README).
