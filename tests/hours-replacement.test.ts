import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canTransition, allowedTransitions, TRANSITION_RULES } from "../src/lib/order-state.ts";
import { splitDuration, pad2, formatHours, deadlineState, canRequestExpiryRemedy, CLOCK_STATUSES, turnaroundHoursFor, MAX_TURNAROUND_HOURS } from "../src/lib/order-deadline.ts";
import { rankPublishers } from "../src/lib/matching.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const hours = strip(read("supabase/PostAtlas_upgrade_hours_replacement.sql"));
const fresh = read("supabase/PostAtlas_fresh_supabase_schema.sql");
const fn = (sql: string, name: string) => { const i = sql.indexOf(`function public.${name}(`); assert.ok(i >= 0, `${name} missing`); return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3); };

// ---- timer arithmetic ---------------------------------------------------------------------------------------------
test("timer digits: hours are not wrapped at 24, seconds tick, and past-deadline counts up", () => {
  assert.deepEqual(splitDuration(((47 * 60 + 59) * 60 + 58) * 1000), { late: false, hours: 47, minutes: 59, seconds: 58 });
  assert.deepEqual(splitDuration(1000), { late: false, hours: 0, minutes: 0, seconds: 1 });
  assert.deepEqual(splitDuration(0), { late: true, hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(splitDuration(-((2 * 60 + 3) * 60 + 4) * 1000), { late: true, hours: 2, minutes: 3, seconds: 4 });
  assert.equal(pad2(7), "07"); assert.equal(pad2(12), "12");
});

test("the timer is derived from the absolute deadline, so a refresh or a sleeping tab cannot change it", () => {
  const due = "2026-10-18T12:00:00Z"; const t0 = Date.parse(due) - 48 * 3600_000;
  for (const elapsed of [0, 1000, 3_600_000, 47 * 3600_000]) {
    const s = deadlineState({ status: "ACCEPTED", due_at: due }, t0 + elapsed);
    assert.equal(s.kind, "running"); if (s.kind === "running") assert.equal(s.msLeft, 48 * 3600_000 - elapsed);
  }
  const src = read("src/components/OrderTimer.tsx");
  assert.match(src, /Date\.parse\(dueAt\)/); assert.match(src, /serverNow - Date\.now\(\)/);   // clock-skew correction
  assert.match(src, /setInterval\(tick, 1000\)/); assert.match(src, /router\.refresh\(\)/);
  assert.match(src, /useState\(due - serverNow\)/);                                           // first render uses the server clock: no hydration mismatch
  assert.match(read("src/components/DeadlineNotice.tsx"), /serverNow=\{Date\.now\(\)\}/);
});

test("turnaround is in hours end to end", () => {
  assert.equal(turnaroundHoursFor(36), 36); assert.equal(formatHours(36), "36 hours"); assert.equal(formatHours(48), "48 hours"); assert.equal(formatHours(120), "5 days");
  const form = read("src/app/publisher/listings/page.tsx");
  assert.match(form, /name="turnaround_hours_min"/); assert.match(form, /name="turnaround_hours_max"/); assert.ok(!/turnaround_days|\(days\)/.test(form));
  const act = read("src/lib/actions/publishers.ts");
  assert.match(act, /turnaround_hours_min/); assert.match(act, /MAX_TURNAROUND_HOURS/); assert.ok(!/turnaround_days/.test(act));
  assert.equal(MAX_TURNAROUND_HOURS, 2880);
  for (const f of ["src/lib/match-data.ts", "src/app/(marketing)/publishers/page.tsx", "src/app/(marketing)/publishers/[domain]/page.tsx", "src/app/dashboard/orders/new/page.tsx"]) assert.ok(!/turnaround_days/.test(read(f)), f);
});

test("matching rewards delivery within 168 hours and words it in hours", () => {
  const opp: any = { niche: "tech", country: null, language: null, maxPrice: null, minDr: null };
  const base: any = { websiteId: "w", niche: "tech", country: null, language: null, priceGuestPost: 50, priceLinkInsertion: null, turnaroundMin: 24, turnaroundMax: 48, linkType: "dofollow", metrics: null, indexed: null };
  const [r] = rankPublishers(opp, [base]);
  assert.ok(r.match.reasons.some((x: string) => /48 hours/.test(x)), JSON.stringify(r.match.reasons));
});

// ---- replacement: state rules --------------------------------------------------------------------------------------
test("the original publisher can deliver a requested replacement; nobody else can skip the check", () => {
  assert.equal(canTransition("REPLACEMENT_REQUESTED", "PUBLISHED", "publisher"), true);
  for (const a of ["customer", "system"] as const) assert.equal(canTransition("REPLACEMENT_REQUESTED", "PUBLISHED", a), false, a);
  assert.equal(canTransition("REPLACEMENT_REQUESTED", "VERIFIED", "publisher"), false);
  assert.equal(canTransition("REPLACEMENT_REQUESTED", "MONITORING", "publisher"), false);
  assert.equal(canTransition("ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "customer"), true);
  assert.equal(canTransition("ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "publisher"), false);
  for (const to of ["IN_PROGRESS", "PENDING_PUBLISHER", "CANCELLED"] as const) assert.ok(allowedTransitions("REPLACEMENT_REQUESTED", "admin").includes(to), `admin keeps ${to}`);
  assert.equal(canTransition("REPLACEMENT_REQUESTED", "PUBLISHER_REJECTED", "customer"), true);
  assert.ok(TRANSITION_RULES.filter((r) => r.from === "REPLACEMENT_REQUESTED").length === 5);
});

test("the delivery clock and the refund/alternative choice cover a requested replacement", () => {
  assert.ok((CLOCK_STATUSES as readonly string[]).includes("REPLACEMENT_REQUESTED"));
  const due = "2026-10-18T12:00:00Z", t = Date.parse(due);
  assert.equal(canRequestExpiryRemedy({ status: "REPLACEMENT_REQUESTED", due_at: due }, t - 1), false);
  assert.equal(canRequestExpiryRemedy({ status: "REPLACEMENT_REQUESTED", due_at: due }, t + 1), true);
});

// ---- replacement + hours: SQL ---------------------------------------------------------------------------------------------
test("hours upgrade: columns, bounds, conversion, public grant, new pairs, no leftover reference to the dropped helper", () => {
  assert.match(hours, /add column if not exists turnaround_hours_min int/); assert.match(hours, /add column if not exists turnaround_hours_max int/);
  assert.match(hours, /between 1 and 2880/); assert.match(hours, /turnaround_hours_min <= turnaround_hours_max/);
  assert.match(hours, /set turnaround_hours_max = turnaround_days_max \* 24 where turnaround_hours_max is null/);
  assert.match(hours, /grant select \(turnaround_hours_min, turnaround_hours_max\) on public\.publisher_websites to anon, authenticated/);
  assert.match(fn(hours, "order_turnaround_hours"), /coalesce\(p_hours, 168\)/);
  assert.match(hours, /\('REPLACEMENT_REQUESTED', 'PUBLISHED'\)/); assert.match(hours, /\('REPLACEMENT_REQUESTED', 'PUBLISHER_REJECTED'\)/);
  assert.match(fresh, /\('REPLACEMENT_REQUESTED', 'PUBLISHED'\)/);
  assert.equal((hours.match(/turnaround_hours_for\(/g) ?? []).length, 1, "only the drop statement may mention the old helper");
  assert.match(hours, /drop function if exists public\.turnaround_hours_for\(int\)/);
  assert.ok(!/drop\s+table|truncate|delete\s+from|drop\s+column/i.test(hours), "additive: no data is dropped");
  assert.match(fresh, /17\. TURNAROUND IN HOURS AND THE REPLACEMENT-ORDER FIX/);
});

test("a requested replacement starts a fresh window; starting work after it restarts too; deadline columns stay database-managed", () => {
  const f = fn(hours, "transition_order");
  assert.match(f, /v_restart := p_to in \('ACCEPTED', 'REPLACEMENT_REQUESTED'\) or \(p_to = 'IN_PROGRESS' and p_from in \('REPLACEMENT_REQUESTED', 'DISPUTED'\)\)/);
  assert.match(f, /order_turnaround_hours\(null\)/);
  assert.match(f, /set_config\('postatlas\.deadline', '1', true\)/);
  assert.match(fn(hours, "request_expiry_remedy"), /'ACCEPTED', 'IN_PROGRESS', 'REPLACEMENT_REQUESTED'/);
  assert.match(fn(hours, "create_order_priced"), /w\.turnaround_hours_max into lst/);
});

// ---- replacement: application code ------------------------------------------------------------------------------------
test("requesting a replacement goes to BOTH the admin and the original publisher, only while an issue is open", () => {
  const src = read("src/lib/actions/orders.ts");
  const a = src.slice(src.indexOf("export async function requestReplacement"), src.indexOf("const REMEDY_ERRORS"));
  assert.match(a, /actionSession\(\)/); assert.match(a, /cap: "manageOrders"/); assert.match(a, /rateLimit\(/);
  assert.match(a, /order\.status !== "ISSUE_DETECTED"/);
  assert.match(a, /notifyMany\(\[parties\.publisherUserId\]/); assert.match(a, /notifyStaff\("Replacement requested"/);
});

test("the original publisher can submit the replacement URL: action, validation and UI", () => {
  const src = read("src/lib/actions/fulfillment.ts");
  const a = src.slice(src.indexOf("export async function submitPublishedUrl"), src.indexOf("export async function requestRestorationCheck"));
  assert.match(a, /publisherOrder\(formData\)/);                                   // loads the order only if it is on THIS publisher's listing
  assert.match(a, /"REPLACEMENT_REQUESTED"\]\.includes\(status\)/);
  assert.match(a, /validatePublicHttpUrl/); assert.match(a, /must be on your listed domain/); assert.match(a, /not the homepage/);
  assert.match(a, /transitionOrder\(order\.id, status, "PUBLISHED"/);               // never straight to VERIFIED: the real check decides
  assert.match(a, /runPlacementCheck\(placement\.id/);
  assert.match(a, /rateLimit\(/);
  const page = read("src/app/publisher/orders/[id]/page.tsx");
  assert.match(page, /"VERIFICATION_PENDING", "REPLACEMENT_REQUESTED"\]\.includes\(status\)/); assert.match(page, /Submit the replacement&apos;s live URL|Submit the replacement's live URL/);
});

test("monitoring tells both sides, and a verified replacement closes the restoration case without a second payout", () => {
  const m = read("src/lib/services/placements.ts");
  assert.match(m, /"placement\.issue"[\s\S]{0,400}await openRestorationCase/);
  assert.match(m, /rpc\("mark_case_restored"/);
  assert.match(m, /onPlacementVerified\(order\.id, now\)/);
  const r = read("src/lib/services/recovery.ts");
  assert.ok(!/< 60_000\) \{\s*await notifyMany|created_at\) < 60_000\) \{\n?\s*await notifyMany/.test(r));
  assert.match(r, /A verified link was removed/);
});

test("publishers see placements that need a fix, in the group and on the overview", () => {
  assert.match(read("src/lib/order-groups.ts"), /key: "answer", label: "Needs your action", statuses: \["PENDING_PUBLISHER", "ISSUE_DETECTED", "REPLACEMENT_REQUESTED"\]/);
  assert.match(read("src/app/publisher/page.tsx"), /REPLACEMENT_REQUESTED/);
});

test("the cron announces a missed replacement deadline too", () => {
  assert.equal((read("src/lib/services/deadlines.ts").match(/"REPLACEMENT_REQUESTED"/g) ?? []).length, 2);
});
