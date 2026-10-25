# Individual customers, order journey and SEO report: implementation report

## 1. Root cause: why customers were blocked
Signup had already been reduced to name, email and password, and it no longer created an organisation. But the rest of the app still treated "customer" as "member of an organisation":

* `requireOrg()` (14 dashboard pages) redirected to `/dashboard/settings` when there was no membership, and `actionOrg()` (every customer action: add website, create order, pay, submit article, dispute, advice) threw "You are not a member of an organisation yet".
* The dashboard home showed "Join or create an organization", and **Settings had no way to create one** - a dead end. A new customer could register and then do nothing.
* The database makes `organization_id NOT NULL` on websites, opportunities, orders, audits and advice, and every RLS policy and the order-integrity triggers key on organisation membership.
* A stale test (`signUp validates the organization name BEFORE...`) still passed only because a comment contained the words "organization name"; it asserted the old behaviour and has been replaced.

## 2. Design decision (and its implications)
`organization_id` was **not** made nullable. That would have changed ~14 tables, all RLS policies, unique indexes, triggers, and weakened the one-owner model for money-related rows. Instead a **workspace** owns customer data, and it is either:

* `personal` - a private single-owner workspace the server creates **automatically and only when needed** (first dashboard visit / first create action) through `ensure_personal_workspace(uuid)`. The customer never names or sets it up and the UI calls it "Personal account".
* `team` - the original organisation: optional, created by the customer, with roles and invitations.

Guarantees enforced in Postgres (not only in app code): one personal workspace per user (partial unique index, race-safe); its only member is its owner; no invitations into it; `kind`/`owner` immutable; the function is service-role-only with a pinned `search_path`. RLS policies are **unchanged**: a personal workspace is just an organisation with one owner member, so nothing became more visible to anyone. Existing organisations become `kind = 'team'` automatically; no data is rewritten.

Implications: personal and team data stay separate (switch in Settings); a person who joins a team defaults to it (the stored preference is only a hint and is ignored unless it is a real membership); a team "viewer" cannot create orders and can switch to their personal account instead.

## 3. Account model
| Account | How it is created | Can do | Cannot do |
|---|---|---|---|
| Individual customer | Public signup (name, email, password) | Own websites, opportunities, orders, payments, content, disputes, advice in their personal workspace | See anyone else's data |
| Team customer | Optional "Create team" in Settings, or an invitation | Same, in the team, limited by role (owner, manager, specialist, content, viewer) | Act outside their role |
| Individual publisher / publisher agency | Separate `/apply-publisher` onboarding, admin approval (unchanged) | Existing publisher area and listing review workflow (unchanged) | Be assigned by signup or a form field |
| Admin / super admin | Granted only by an admin / by SQL (unchanged) | Existing admin area | Never get a customer workspace |

Signup still always creates role `user` (DB trigger). No form field, metadata or new code path can set a platform role (asserted by tests).

## 4. Authorisation changes
* `getSession()` now loads all memberships; the active workspace is chosen by `pickActiveWorkspace()` (pure, tested).
* New `requireWorkspace()` / `actionWorkspace(cap)`: guarantee a workspace for customers (and publishers), redirect staff to `/admin`, still enforce the role capability.
* **Actions on existing records no longer depend on the "active" org.** `loadOrderFor(..., {kind:"member"})` and `assertWorkspaceCapability()` authorise by the caller's membership role in the workspace that *owns* the record, using the identity from the session. Non-members get "not found" (no existence leak). Applied to: cancel, replacement, pay, submit article, re-check, dispute, advice reply/close, analyse website, select/dismiss opportunity.
* Teams: `inviteTeammate`/`revokeInvitation` refuse a personal workspace. New actions `createTeam` (rate limited, max 5 owned teams) and `switchWorkspace` (membership re-verified).
* Lists on the dashboard (home, websites, opportunities, orders, new-order form) are scoped to the active workspace.

## 5. Order journey and statuses (existing state machine kept; transitions are server-side, role-checked, compare-and-set in Postgres, and audited in `order_events`)
1. Visitor runs a public check -> report with eligible publishers. 2. "Order this placement" -> `/dashboard/start?check=&publisher=`; if signed out, the proxy sends them to login/signup with `next=` that exact URL and they return to it. 3. `startFromCheck` validates the report, that the publisher is still **approved and priced**, adds the checked site to the customer's workspace and offers only pages the check actually saw. 4. Order form: price is read from the listing on the server again at submission; duplicate live orders are blocked by a unique index. `PAYMENT_PENDING`. 5. Customer submits payment reference -> `PAYMENT_UNDER_REVIEW`. 6. Admin approves -> `PAID` (or back to `PAYMENT_PENDING`). 7. Customer submits article -> `CONTENT_SUBMITTED` -> `PENDING_PUBLISHER` (policy-clear automatically, otherwise held for admin). 8. Publisher accepts (`ACCEPTED`/`IN_PROGRESS`) or declines (`PUBLISHER_REJECTED`). 9. Publisher submits URL -> `PUBLISHED` -> real check -> `VERIFICATION_PENDING` -> `VERIFIED` -> `MONITORING`. 10. Issues: `ISSUE_DETECTED`, `REPLACEMENT_REQUESTED`, `DISPUTED` (admin resolves). 11. Terminal: `COMPLETED` (admin, from `MONITORING`) or `CANCELLED`. Payment approval is never completion.

## 6. SEO report
See `docs/SEO_DATA.md`. Four sections (authority/backlinks, organic, technical, gap/opportunities) with Observed / Provider index data / Estimate / Calculated labels, provider + date, partial-data and unavailable states with reasons, SVG charts and a country breakdown. Old stored reports still render with a "run a new check" notice. Nothing is shown as 0 when absent. DR/DA are never derived internally.

## 7. Commands (Windows PowerShell)
```powershell
cd path\to\postatlas
node --version                      # needs >= 20.9
npm ci
Copy-Item .env.example .env.local   # then edit .env.local with your real values
# Database (Supabase SQL Editor, not PowerShell):
#   existing install : run supabase\PostAtlas_upgrade_individual_customers.sql once, then supabase\PostAtlas_verify_schema.sql
#   new install      : run supabase\PostAtlas_fresh_supabase_schema.sql once (already includes the upgrade), then the verify file
npm run typecheck
npm test
npm run build
npm run dev                         # http://localhost:3000
```
Optional SEO provider: set `SEO_PROVIDER=ahrefs` and `AHREFS_API_KEY=...` in `.env.local`, restart.
**Security note:** the ZIP you sent contained a real `.env`. It is not included in the returned ZIP. Treat those Supabase service-role/anon keys, the email key and `CRON_SECRET` as exposed and rotate them.

## 8. Test report
See the chat reply for the exact run. Summary of coverage and gaps:
* Executed and passing: 197 unit/static tests (`npm test`), including the new `workspace`, `seo-technical`, `seo-provider` suites and updated guard tests.
* NOT executed (blocked: no `node_modules`, no network, no Postgres/Supabase in the build sandbox): `npm run typecheck`, lint, `npm run build`, running either SQL file, and every end-to-end/RLS/auth test (signup -> order, cross-customer access denial, team permissions, publisher/agency flows, payment -> fulfilment, live provider calls). Only the dependency-free modules were strict-typechecked with `tsc`.
* Recommended before release: run the commands above, apply the SQL to a staging copy, then walk the journey with two customer accounts, one team with an owner and a viewer, one publisher and one admin.

## 9. Known limitations
* Not compiled or built here; expect to fix small type errors on first `npm run typecheck`.
* SQL unexecuted. Review `supabase/PostAtlas_upgrade_individual_customers.sql` on staging first.
* Ahrefs response shapes are fixture-tested only; Domain Authority, dofollow/nofollow totals and Semrush/Moz/DataForSEO are not implemented.
* A customer can add any domain (no domain-ownership verification existed and none was added); buying a link to a third-party site is permitted.
* Team and personal lists are separated by active workspace; placements, monitoring, saved publishers and advice lists still show everything the person can access.
* Publisher agencies: unchanged and not re-tested here.
* The public check can take up to ~30s because the crawl and provider calls run in one request (limit 60s).
