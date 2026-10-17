# Site reviews, order deadlines, expired-order options, legal pages, navigation

## Database step (required once)
Existing database: run `supabase/PostAtlas_upgrade_reviews_deadlines.sql` once in the Supabase SQL editor (after the payout-hardening upgrade). It is idempotent and additive. New installs already contain it (section 16 of the fresh schema). Nothing works without it: the new pages read columns and a table that only exist after it runs.

## Order completion timer
* `orders.turnaround_hours` is copied from the listing's **slowest turnaround (days x 24)** when the order is placed, inside `create_order_priced()`. A listing with no stated turnaround gets **7 days**. A later listing edit never moves a deadline the customer already relied on. (There is no per-order turnaround picker: the listing states one window, and that is what the customer sees before ordering.)
* The clock starts when the publisher accepts: `transition_order()` stamps `accepted_at` and `due_at = now() + turnaround_hours`. Starting work does not reset it. A fresh window starts only when work restarts after a replacement request or a resolved dispute, and when an admin reassigns the order and the new publisher accepts (the window then follows the new listing).
* `accepted_at`, `due_at`, `turnaround_hours` and the expiry fields cannot be changed by direct UPDATE, even with the service role (`orders_guard`).
* The clock only applies in `ACCEPTED` / `IN_PROGRESS`. Once the live URL is submitted it no longer matters.
* Shown on the customer order page, the publisher order page, both order lists and the admin order page. A small client island adds "x hours left"; the deadline itself is decided by the database.

## Expired orders: refund or alternative
* "Expired" is derived (`due_at` passed while `ACCEPTED`/`IN_PROGRESS`), so the options appear on the order page the moment the deadline passes, even if the cron has not run.
* The finance cron (every 30 minutes) sends one notification (in-app + email) to the customer and the publisher, claimed with a compare-and-set on `expiry_notified_at` so it is never repeated.
* The customer (owner or SEO manager) chooses **Find me another publisher** or **Request a refund**: `request_expiry_remedy()` re-checks membership, confirmed payment, status and deadline in one transaction, then
  * moves the order to `PUBLISHER_REJECTED` (the existing "needs recovery" state; two new legal pairs `ACCEPTED`/`IN_PROGRESS` -> `PUBLISHER_REJECTED`, customer only),
  * cancels the publisher's **unpaid** entitlement (money already paid out is never clawed back),
  * opens a recovery case of the new kind `publisher_timeout` (48h admin window; shown in Recovery cases),
  * for a refund, files a refund **request**. It reuses the existing manual workflow (requested -> approved -> processing -> completed, with transfer reference and evidence); the order becomes `CANCELLED` only after a completed full refund. **Nothing is refunded automatically.**
  * For an alternative, the admin uses the existing Reassign form (same price, same article); if no publisher is available the admin closes the case with a refund as before.
* Until the customer chooses, the publisher may still deliver late (decision documented in the Refund Policy).

## Site reviews
* Table `site_reviews`: one row per order (`unique(order_id)`), attached to the **listing** that delivered the placement, never to a publisher profile.
* Who/when: owner or SEO manager of the buying workspace, after the placement is verified (`VERIFIED`, `MONITORING` or `COMPLETED` **and** a verified placement on record). "Completed" is read as "delivered and verified", because `COMPLETED` itself is admin-only and rarely reached.
* 1-5 stars, optional text (3-1500 chars, web addresses refused because reviews are public text on a link marketplace). Reviews cannot be edited or repeated. Reviewer identity is never public (the public column grant excludes it); the listing shows "Verified buyer".
* Shown on `/publishers/<domain>` (summary, distribution, list) and as a rating on marketplace cards. Pages are cached for an hour; submitting or moderating revalidates the listing.
* Admins can hide/restore a review with a reason at `/admin/reviews` (text is never edited). Publishers are notified of new reviews.

## Legal pages
`/privacy`, `/terms`, `/refund-policy` now have full content written against how the platform actually works (manual transfers, 2% commission read from `COMMISSION_BPS`, deadlines, recovery cases, manual refunds). Shared facts live in `src/lib/legal.ts`.
**Before launch:** have a qualified lawyer review them, and confirm `LEGAL.governingLaw` (set to Pakistan as a placeholder), the effective date, and whether you need to name a registered entity and address.

## Navigation
Clear action labels in every area, same verb for the same destination:
customer: Overview, My Websites, Find Link Opportunities, Find Publishers, Manage Orders, Track Placements, Monitor Backlinks, Account Settings, Get Advice;
publisher: Overview, Manage Orders, Manage Listings, Track Payouts; admin labels follow the same pattern (+ Moderate Reviews);
public header: Explore Sites, Check Your Website, For Publishers, How It Works, Pricing, Resources. Switching area reads "Switch to ... Dashboard".

## Tests
`npm test`: new `tests/deadlines-reviews.test.ts` (pure rules + SQL/app static checks) and `tests/db-reviews-deadlines.test.ts` (runs the real schema in PGlite: clock start, direct-edit refusal, refund/alternative flow, reassignment, review rules, privileges, idempotent upgrade). `ui-system.test.ts` was updated for the new labels.
