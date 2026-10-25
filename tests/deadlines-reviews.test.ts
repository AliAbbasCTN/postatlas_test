import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { canTransition, allowedTransitions } from "../src/lib/order-state.ts";
import { DEFAULT_TURNAROUND_HOURS, turnaroundHoursFor, deadlineState, canRequestExpiryRemedy, formatHours, formatDuration, closedOrderLabel, formatDueUtc } from "../src/lib/order-deadline.ts";
import { canReviewOrder, parseRating, summarizeRatings, ratingText, REVIEWABLE_STATUSES } from "../src/lib/review.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const up = strip(read("supabase/PostAtlas_upgrade_reviews_deadlines.sql"));
const fresh = read("supabase/PostAtlas_fresh_supabase_schema.sql");
const hours = strip(read("supabase/PostAtlas_upgrade_hours_replacement.sql"));
const fn = (sql: string, name: string) => { const i = sql.indexOf(`function public.${name}(`); assert.ok(i >= 0, `${name} missing`); return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3); };

// ---- deadline rules ------------------------------------------------------------------------------------------
test("turnaround is stated in hours and a missing one uses the same default as the database", () => {
  assert.equal(turnaroundHoursFor(48), 48);
  assert.equal(turnaroundHoursFor(null), DEFAULT_TURNAROUND_HOURS);
  assert.match(fn(hours, "order_turnaround_hours"), new RegExp(`coalesce\\(p_hours, ${DEFAULT_TURNAROUND_HOURS}\\)`));
});

test("the clock only exists while the publisher owes delivery", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const due = "2026-10-18T12:00:00Z";
  assert.equal(deadlineState({ status: "ACCEPTED", due_at: due }, now).kind, "running");
  assert.equal(deadlineState({ status: "IN_PROGRESS", due_at: due }, now + 25 * 3600_000).kind, "overdue");
  for (const s of ["PENDING_PUBLISHER", "PUBLISHED", "VERIFIED", "CANCELLED", "PUBLISHER_REJECTED", "DISPUTED"]) assert.equal(deadlineState({ status: s, due_at: due }, now + 99 * 3600_000).kind, "none", s);
  assert.equal(deadlineState({ status: "ACCEPTED", due_at: null }, now).kind, "none");
  assert.equal(deadlineState({ status: "ACCEPTED", due_at: "garbage" }, now).kind, "none");
});

test("a refund or alternative can be requested only after the deadline, never before", () => {
  const due = "2026-10-18T12:00:00Z", t = Date.parse(due);
  assert.equal(canRequestExpiryRemedy({ status: "ACCEPTED", due_at: due }, t - 1), false);
  assert.equal(canRequestExpiryRemedy({ status: "ACCEPTED", due_at: due }, t), true);    // the instant the deadline is reached it counts as passed (SQL refuses only while due_at > now())
  assert.equal(canRequestExpiryRemedy({ status: "ACCEPTED", due_at: due }, t + 1), true);
  assert.equal(canRequestExpiryRemedy({ status: "PUBLISHED", due_at: due }, t + 1e9), false);
});

test("time formatting", () => {
  assert.equal(formatHours(48), "48 hours"); assert.equal(formatHours(1), "1 hour"); assert.equal(formatHours(72), "3 days"); assert.equal(formatHours(170), "7 days 2 hours");
  assert.equal(formatDuration(90 * 60_000), "1 hour 30 minutes"); assert.equal(formatDuration(26 * 3600_000), "1 day 2 hours"); assert.equal(formatDuration(-5), "0 minutes");
  assert.equal(formatDueUtc("2026-10-18T14:05:00Z"), "Oct 18, 2026, 2:05 PM UTC");
  assert.equal(closedOrderLabel("PUBLISHER_REJECTED", "refund"), "Deadline missed: refund requested");
  assert.equal(closedOrderLabel("PUBLISHER_REJECTED", null), null);
  assert.equal(closedOrderLabel("ACCEPTED", "refund"), null);
});

test("only the customer can close out an overdue order, and only from ACCEPTED or IN_PROGRESS", () => {
  for (const from of ["ACCEPTED", "IN_PROGRESS"] as const) {
    assert.equal(canTransition(from, "PUBLISHER_REJECTED", "customer"), true);
    for (const a of ["publisher", "admin", "system"] as const) assert.equal(canTransition(from, "PUBLISHER_REJECTED", a), false, `${from} ${a}`);
  }
  assert.equal(canTransition("PUBLISHED", "PUBLISHER_REJECTED", "customer"), false);
  assert.ok(allowedTransitions("PUBLISHER_REJECTED", "admin").includes("PENDING_PUBLISHER"), "admin can still reassign after the customer's choice");
});

// ---- deadline SQL (static; tests/db-reviews-deadlines.test.ts executes it) ---------------------------------------------
test("the clock starts inside transition_order, from the snapshot, and restarts only for replacement or a resolved dispute", () => {
  const f = fn(up, "transition_order");
  assert.match(f, /accepted_at\s*=\s*case when p_to = 'ACCEPTED' then now\(\)/);
  assert.match(f, /make_interval\(hours => coalesce\(o\.turnaround_hours/);
  assert.match(f, /p_to = 'IN_PROGRESS' and p_from in \('REPLACEMENT_REQUESTED', 'DISPUTED'\)/);
  assert.match(f, /compare|update public\.orders o set/i);
  assert.ok(!/'ACCEPTED'\s*and p_from\s*=\s*'IN_PROGRESS'/.test(f), "starting work must not reset the clock");
});

test("deadline columns cannot be written outside the database workflow", () => {
  const g = fn(up, "orders_guard");
  assert.match(g, /order deadline fields can only be changed by the database workflow/);
  assert.match(g, /the order turnaround can only be set when the order is placed or reassigned/);
  assert.match(g, /new\.accepted_at := null; new\.due_at := null/);
  assert.match(fn(up, "transition_order"), /set_config\('postatlas\.deadline', '1', true\)/);
});

test("order creation snapshots the turnaround in the database, never from the caller", () => {
  const f = fn(hours, "create_order_priced");
  assert.match(f, /turnaround_hours_max/); assert.match(f, /order_turnaround_hours\(lst\.turnaround_hours_max\)/);
  assert.ok(!/p_turnaround/.test(up + hours));
  assert.match(fn(hours, "reassign_order"), /turnaround_hours = public\.order_turnaround_hours\(lst\.turnaround_hours_max\)/);
});

test("request_expiry_remedy re-checks everything in the database and reuses the refund + recovery workflow", () => {
  const f = fn(up, "request_expiry_remedy");
  assert.match(f, /m\.role in \('owner', 'seo_manager'\)/);
  assert.match(f, /o\.status not in \('ACCEPTED', 'IN_PROGRESS'\) or o\.due_at is null or o\.due_at > now\(\)/);
  assert.match(f, /pa\.status = 'PAID'/);
  assert.match(f, /transition_order\(p_order, o\.status, 'PUBLISHER_REJECTED'/);
  assert.match(f, /open_recovery_case\(p_order, 'publisher_timeout'/);
  assert.match(f, /cancel_unpaid_payouts/);
  assert.match(f, /request_refund\(p_order, null,[\s\S]*'customer', 'timeout:'/);
  assert.ok(!/record_refund_result|advance_refund|insert into public\.refunds|update public\.refunds/.test(f), "must only REQUEST a refund; money moves in the admin workflow");
  assert.match(up, /recovery_cases_kind_check check \(kind in \('publisher_rejection', 'link_restoration', 'publisher_timeout'\)\)/);
});

test("new transitions exist in the fresh schema's pair table and the upgrade file", () => {
  assert.match(fresh, /\('ACCEPTED', 'PUBLISHER_REJECTED'\)/); assert.match(fresh, /\('IN_PROGRESS', 'PUBLISHER_REJECTED'\)/);
  assert.match(up, /\('ACCEPTED', 'PUBLISHER_REJECTED'\)/);
});

// ---- reviews ----------------------------------------------------------------------------------------------------------
test("review eligibility: verified placement only, once per order", () => {
  for (const s of REVIEWABLE_STATUSES) assert.equal(canReviewOrder({ status: s, hasVerifiedPlacement: true, alreadyReviewed: false }).ok, true, s);
  for (const s of ["PAID", "PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "ISSUE_DETECTED", "DISPUTED", "CANCELLED", "PUBLISHER_REJECTED"]) assert.equal(canReviewOrder({ status: s, hasVerifiedPlacement: true, alreadyReviewed: false }).ok, false, s);
  assert.equal(canReviewOrder({ status: "COMPLETED", hasVerifiedPlacement: false, alreadyReviewed: false }).ok, false);
  assert.equal(canReviewOrder({ status: "COMPLETED", hasVerifiedPlacement: true, alreadyReviewed: true }).ok, false);
});

test("ratings: 1-5 whole numbers only; summary and text", () => {
  assert.equal(parseRating("5"), 5); assert.equal(parseRating("1"), 1);
  for (const bad of ["0", "6", "3.5", "-1", "", "abc", null, undefined, 4]) assert.equal(parseRating(bad), null, String(bad));
  const s = summarizeRatings([5, 4, 4, 1, 99, 0, 2.5]);
  assert.equal(s.count, 4); assert.equal(s.average, 3.5); assert.deepEqual(s.distribution, { 1: 1, 2: 0, 3: 0, 4: 2, 5: 1 });
  assert.equal(summarizeRatings([]).average, null);
  assert.equal(ratingText(null, 0), "No reviews yet"); assert.equal(ratingText(4.5, 1), "4.5 out of 5 (1 review)");
});

test("review table: one per order, frozen text, public sees only safe columns of published reviews", () => {
  assert.match(up, /order_id\s+uuid not null unique references public\.orders/);
  assert.match(up, /rating\s+smallint not null check \(rating between 1 and 5\)/);
  assert.match(up, /alter table public\.site_reviews enable row level security/);
  assert.match(up, /grant select \(id, listing_id, rating, comment, status, created_at\) on public\.site_reviews to anon, authenticated/);
  assert.ok(!/grant[^;]*\b(order_id|organization_id|reviewer_id)\b[^;]*on public\.site_reviews to (anon|authenticated)/.test(up), "identity columns must not be public");
  assert.match(up, /create policy site_reviews_public on public\.site_reviews for select to anon, authenticated\s+using \(status = 'published' and exists/);
  assert.ok(!/create policy \w+ on public\.site_reviews for (insert|update|delete|all)/.test(up));
  assert.match(fn(up, "site_reviews_guard"), /a submitted review cannot be edited/);
  assert.match(up, /security_invoker = true/);
});

test("submit_site_review enforces membership role, verified placement and one review per order in the database", () => {
  const f = fn(up, "submit_site_review");
  assert.match(f, /m\.role in \('owner', 'seo_manager'\)/);
  assert.match(f, /o\.status not in \('VERIFIED', 'MONITORING', 'COMPLETED'\)/);
  assert.match(f, /pl\.verified_at is not null/);
  assert.match(f, /already been reviewed/);
  assert.match(f, /for update/);
  assert.match(f, /values \(p_order, o\.website_id, o\.organization_id/);   // the review belongs to the LISTING that delivered
});

test("every new function is server-only and the upgrade is additive", () => {
  for (const f of ["request_expiry_remedy(uuid,uuid,text,text)", "submit_site_review(uuid,uuid,int,text)", "moderate_site_review(uuid,uuid,boolean,text)"]) assert.ok(up.includes(`'${f}'`), f);
  assert.match(up, /revoke all on function public\.%s from public, anon, authenticated/);
  assert.ok(!/drop\s+table|truncate|delete\s+from|drop\s+column/i.test(up));
  for (const f of ["request_expiry_remedy", "submit_site_review", "moderate_site_review"]) assert.match(fn(up, f), /security definer set search_path = ''/);
  assert.match(fresh, /function public\.request_expiry_remedy\(/); assert.match(fresh, /create table if not exists public\.site_reviews/);
});

// ---- application code -------------------------------------------------------------------------------------------------
test("the customer's choice goes through the database function with a session, role and rate limit", () => {
  const src = read("src/lib/actions/orders.ts");
  const a = src.slice(src.indexOf("export async function resolveExpiredOrder"));
  assert.match(a, /actionSession\(\)/); assert.match(a, /rateLimit\(/);
  assert.match(a, /loadOrderFor\(id, \{ kind: "member", userId: user\.id, cap: "manageOrders" \}\)/);
  assert.match(a, /rpc\("request_expiry_remedy"/);
  assert.ok(!/from\("refunds"\)|record_refund_result|advance_refund/.test(a), "the action must not move money");
  assert.ok(!/formData\.get\("(due_at|deadline|amount)"\)/.test(a));
});

test("reviews: session + role + rate limit + no links; moderation is admin-only", () => {
  const src = read("src/lib/actions/reviews.ts");
  const submit = src.slice(src.indexOf("export async function submitSiteReview"), src.indexOf("export async function moderateReview"));
  const mod = src.slice(src.indexOf("export async function moderateReview"));
  assert.match(submit, /actionSession\(\)/); assert.match(submit, /rateLimit\(/); assert.match(submit, /cap: "manageOrders"/); assert.match(submit, /rpc\("submit_site_review"/); assert.match(submit, /web addresses/);
  assert.match(mod, /actionAdmin\(\)/);
});

test("accepting an order reports the deadline the database started; the cron announces missed deadlines once", () => {
  assert.match(read("src/lib/actions/fulfillment.ts"), /select\("due_at, turnaround_hours"\)/);
  const svc = read("src/lib/services/deadlines.ts");
  assert.match(svc, /is\("expiry_notified_at", null\)/); assert.match(svc, /update\(\{ expiry_notified_at/);
  assert.match(read("src/lib/services/payouts.ts"), /notifyExpiredOrders/);
});

test("reviews appear on the listing page and cards, never on publisher profile pages", () => {
  assert.match(read("src/app/(marketing)/publishers/[domain]/page.tsx"), /loadReviews\(/);
  assert.match(read("src/app/(marketing)/publishers/page.tsx"), /loadRatings\(/);
  for (const f of ["src/app/publisher/page.tsx", "src/app/publisher/listings/page.tsx"]) assert.ok(!/site_reviews|loadReviews/.test(read(f)), f);
});

test("legal pages are no longer placeholders", () => {
  for (const [p, must] of [["privacy", /What we collect/], ["terms", /Reviews and ratings/], ["refund-policy", /misses the delivery deadline/]] as const) {
    const s = read(`src/app/(marketing)/${p}/page.tsx`);
    assert.ok(!/structural starting point/.test(s), p); assert.match(s, must); assert.ok(s.length > 4000, `${p} looks too short`);
  }
});

test("navigation uses clear, action-oriented labels in every workspace", () => {
  const dash = read("src/app/dashboard/layout.tsx"), pub = read("src/app/publisher/layout.tsx"), adm = read("src/app/admin/layout.tsx");
  for (const l of ["Find Publishers", "Manage Orders", "Find Link Opportunities", "Track Placements"]) assert.ok(dash.includes(`"${l}"`), l);
  for (const l of ["Manage Orders", "Manage Listings"]) assert.ok(pub.includes(`"${l}"`), l);
  assert.ok(adm.includes('"Manage Orders"') && adm.includes("/admin/reviews"));
  assert.ok(read("src/components/SiteHeader.tsx").includes('"Explore Sites"'));
  for (const f of [dash, pub, adm]) assert.ok(!/label: "(Orders|Publishers|Settings|Placements|Opportunities)"/.test(f), "a vague label is left");
  // The same destination must carry the same verb in both workspaces.
  assert.ok(dash.includes('label: "Manage Orders"') && pub.includes('label: "Manage Orders"'));
});

test("every server action file still authenticates (new actions included)", () => {
  assert.ok(readdirSync(new URL("../src/lib/actions/", import.meta.url)).includes("reviews.ts"));
});
