# PostAtlas

Find the pages on your website that need links, match them with relevant publishers, order the placement, and have PostAtlas verify and keep monitoring it.

**DIAGNOSE -> MATCH -> ACQUIRE -> VERIFY -> MONITOR**

Next.js (App Router) + Supabase. Customers buy as **individuals with no setup** (the server keeps a private personal workspace for them) or as members of an optional **team** with org roles. **Publisher, Admin and Super Admin are platform roles** that only an admin can grant.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in. `SITE_URL` is required in production.
3. Create the database: Supabase -> SQL Editor -> New query -> paste `supabase/PostAtlas_fresh_supabase_schema.sql` -> Run **once** on an empty `public` schema. Then run `supabase/PostAtlas_verify_schema.sql` and check each result against the comment above it. There are no incremental migrations; upgrades are separate one-off files (see below).
4. Sign up in the app and confirm your email, then promote that account in the SQL editor (deliberately impossible from the app):
   `update public.profiles set platform_role = 'super_admin' where email = 'you@example.com';`
5. Add a payment method at `/admin/settings` (super admin) so customers can pay.
6. Schedule monitoring: `vercel.json` calls `/api/cron/monitor` hourly with `Authorization: Bearer $CRON_SECRET`. On other hosts, call that URL on a schedule.
7. `npm run dev`

Design system and UI notes: `docs/FRONTEND_REDESIGN.md`. Login/signup error handling: `src/lib/auth-errors.ts` (optional rate-limiter SQL patch: `supabase/PostAtlas_patch_auth_rate_limit.sql`).

Scripts: `npm test` (unit tests, no install needed beyond Node 22.18+), `npm run typecheck`, `npm run build`.

**Already installed the fresh schema before the public website check was added?** Run `supabase/PostAtlas_addon_site_checks.sql` once. New installs get the `site_checks` table from the fresh schema file and must NOT run the add-on.

## Product map

| Area | Where |
| --- | --- |
| Customer workspace: Overview, My Websites, Find Link Opportunities, Find Publishers, Manage Orders, Track Placements, Monitor Backlinks, Account Settings, Get Advice | `/dashboard/*` |
| Publisher (a verified account that lists websites and receives orders): Manage Orders, Manage Listings, Track Payouts | `/publisher/*` (explained at `/for-publishers`, apply at `/apply-publisher`). Blog contributions are separate: `/write-for-us` |
| Admin: orders, payments, publishers, disputes, advice, users, audit log | `/admin/*` |
| Public: homepage, free website check (`/check`, no account), report (`/check/<id>`), marketplace, publisher pages, resources | `/`, `/check`, `/publishers`, `/blog` ... |
| Sign-in is needed only to order, ask for advice, or use the dashboard | `/dashboard/start` continues an order from a report |

Order lifecycle (`src/lib/order-state.ts`, mirrored in the database): payment pending -> under review -> approved (article needed) -> article submitted (held only if a content-policy term is flagged) -> publisher review -> accepted -> in progress -> published -> verification -> verified -> monitoring, with issue detected, replacement requested, disputed, cancelled and completed.

## How data honesty works

* The audit records only what it **observed** (HTTP status, title, noindex, canonical).
* Referring-domain numbers come only from an `SeoDataProvider` (`src/lib/providers/seo-provider.ts`). **No provider is configured out of the box**, so authority-gap opportunities are not generated and the UI says link data is not connected. Customers can still choose pages themselves. Implement the interface for your provider to turn this on.
* Publisher DR/DA/traffic are "reported by publisher" until an admin records verified figures with a stated source. Matching ignores unverified figures.
* Links are marked verified only after a real fetch finds them on the page. Monitoring needs repeated failures before raising an issue.
* Indexing is never claimed.

## Security notes

* Browser roles (anon, authenticated) are **read-only** (RLS + grants). All writes go through server actions that authenticate, authorise, validate and then use the service role.
* Order status changes are compare-and-set in Postgres (`transition_order`) and validated by a trigger; price/owner/target cannot be edited after creation; payments must equal the order price.
* `safeFetch` (the only URL fetcher) blocks private/loopback/metadata addresses, pins the validated IP, limits redirects, time and size.
* Rate limits are stored in Postgres (`rate_limit_hit`).
* CSP currently allows inline scripts (Next bootstrap and JSON-LD). Moving to nonces is a worthwhile follow-up.

## Known gaps

* Publisher "request clarification" and order-level chat are not built (disputes and advice threads exist).
* Attachments / file uploads are not implemented (articles are plain text), so no upload surface exists.
* The Supabase `Database` type in `src/lib/types.ts` no longer covers the new tables; clients are untyped. Regenerate with `supabase gen types typescript` and re-add the generic if you want typed queries.
* No browser end-to-end tests yet.

**Upgrading an existing database to individual-customer support?** Run `supabase/PostAtlas_upgrade_individual_customers.sql` once (idempotent, additive, no data rewritten). New installs already include it - do NOT run it on top of the updated fresh schema. Then run `supabase/PostAtlas_verify_schema.sql`.

See `docs/IMPLEMENTATION_REPORT.md` (account model, order journey, tests, limitations) and `docs/SEO_DATA.md` (which SEO metrics need which provider).

**Marketplace finance upgrade** (USD pricing + 2% commission, USD/PKR checkout, payouts, recovery, refunds): after the individual-customers upgrade, run `supabase/PostAtlas_upgrade_marketplace_finance.sql` once on an existing database (new installs already include it). Details, policies and remaining manual steps: `docs/FINANCE.md`.

**Payout hardening** (replacement-publisher budget cap and fixed pay, idempotent payout creation, atomic payout-destination replacement): after the finance upgrade, run `supabase/PostAtlas_upgrade_payout_hardening.sql` (idempotent). New installs already include it. **Required environment:** `PAYOUT_DATA_KEY` must be exactly 32 random bytes in base64 (the placeholder in `.env.example` is rejected on purpose and publishers will see payout settings as unavailable until it is set); `/admin` shows a setup banner for anything required that is missing. `npm test` needs Node 22.18+ (it runs TypeScript directly) and includes database tests that execute the real schema in an in-process PostgreSQL (PGlite).

**Reviews, delivery deadlines and expired-order options**: run `supabase/PostAtlas_upgrade_reviews_deadlines.sql` once on an existing database (idempotent; new installs already include it). Behaviour, assumptions and what still needs a human (legal review): `docs/REVIEWS_AND_DEADLINES.md`.

**SEO research and implementation**: see `docs/seo/README.md` (brand analysis, competitors, keywords, keyword-to-page map, validation, go-live steps). New environment variable: `ALLOW_INDEXING` (see `.env.example`); test and preview hosts are never indexed by default.

**Security**: Next.js is pinned to 16.4.3 (fixes the three October 2026 advisories that affect 16.4.0). After pulling this version run `npm install` once to refresh the lockfile; details in `docs/SECURITY_UPGRADE.md`.
