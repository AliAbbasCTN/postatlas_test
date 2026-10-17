import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withParams } from "../src/lib/query-string.ts";
import { CUSTOMER_GROUPS, PUBLISHER_GROUPS, PUBLISHER_VISIBLE_STATUSES, parseGroup, statusesOf } from "../src/lib/order-groups.ts";
import { ORDER_STATUS_LABEL } from "../src/lib/order-state.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ALL = Object.keys(ORDER_STATUS_LABEL);

test("withParams skips empty values and encodes the rest", () => {
  assert.equal(withParams("/x", {}), "/x");
  assert.equal(withParams("/x", { a: "1", b: undefined, c: "", d: null }), "/x?a=1");
  assert.equal(withParams("/x", { q: "a b&c" }), "/x?q=a+b%26c");
});

test("every order status belongs to exactly one customer tab, so a tab never hides an order that 'All' shows", () => {
  const seen = CUSTOMER_GROUPS.flatMap((g) => g.statuses);
  assert.equal(new Set(seen).size, seen.length, "a status is in two customer tabs");
  assert.deepEqual([...seen].sort(), [...ALL].sort());
});

test("publisher tabs cover exactly the statuses a publisher may see - and nothing earlier in the lifecycle", () => {
  const seen = PUBLISHER_GROUPS.flatMap((g) => g.statuses);
  assert.equal(new Set(seen).size, seen.length);
  for (const hidden of ["PAYMENT_PENDING", "PAYMENT_UNDER_REVIEW", "PAID", "CONTENT_SUBMITTED", "CANCELLED"]) {
    assert.ok(!seen.includes(hidden as never), `${hidden} must never reach a publisher`);
  }
  for (const s of seen) assert.ok(ALL.includes(s), s);
  assert.equal(PUBLISHER_VISIBLE_STATUSES.length, 12);
});

test("unknown tab values mean 'All' and can never select a status outside the allowed set", () => {
  assert.equal(parseGroup("bogus", PUBLISHER_GROUPS), "");
  assert.equal(parseGroup(undefined, CUSTOMER_GROUPS), "");
  assert.equal(parseGroup("action", CUSTOMER_GROUPS), "action");
  assert.deepEqual(statusesOf("", PUBLISHER_GROUPS, PUBLISHER_VISIBLE_STATUSES).sort(), [...PUBLISHER_VISIBLE_STATUSES].sort());
  // Even if a group listed a hidden status, `allowed` would strip it.
  assert.deepEqual(statusesOf("answer", PUBLISHER_GROUPS, ["ACCEPTED"]), []);
});

test("the customer 'needs action' tab matches what the order page asks the customer to do", () => {
  assert.deepEqual([...CUSTOMER_GROUPS[0].statuses].sort(), ["ISSUE_DETECTED", "PAID", "PAYMENT_PENDING"]);
});

test("publisher orders list stays confined to the publisher's own listings and visible statuses", () => {
  const s = read("src/app/publisher/orders/page.tsx");
  assert.match(s, /requirePublisher\(\)/);
  assert.match(s, /\.in\("website_id", ids\)/);
  assert.match(s, /statusesOf\(group, PUBLISHER_GROUPS, visible\)/);
  assert.ok(!/statusesOf\([^)]*PUBLISHER_GROUPS\)(?!,)/.test(s.replace(/statusesOf\(key as never, PUBLISHER_GROUPS, visible\)/g, "")), "every publisher status filter must pass the allowed list");
});

test("customer orders list is still scoped to the signed-in workspace", () => {
  const s = read("src/app/dashboard/orders/page.tsx");
  assert.match(s, /requireWorkspace\(\)/);
  assert.ok((s.match(/\.eq\("organization_id", org\.id\)/g) ?? []).length >= 3, "list, total and per-tab counts must all be workspace-scoped");
});

test("lists have a mobile layout and accessible table headers", () => {
  for (const f of ["src/app/dashboard/orders/page.tsx", "src/app/publisher/orders/page.tsx"]) {
    const s = read(f);
    assert.match(s, /hidden md:block/);
    assert.match(s, /md:hidden/);
    assert.match(s, /scope="col"/);
    assert.match(s, /FilterTabs/);
  }
});

test("marketplace: server-side filtering kept, filters explained, applied filters removable, no tooltip inside a label", () => {
  const s = read("src/app/(marketing)/publishers/page.tsx");
  assert.match(s, /\/\^\[a-z0-9\]\[a-z0-9\.-\]\{1,59\}\$\/i/, "domain whitelist must remain");
  assert.match(s, /FilterChips/);
  assert.match(s, /HelpTip label="DR"/);
  assert.match(s, /price_link_insertion/);
  assert.ok(!/<label[^>]*>[^<]*<HelpTip/.test(s), "interactive content must not be nested in a <label>");
  assert.match(s, /Showing \$\{from\}/);
});

test("HelpTip, FilterChips and FilterTabs are accessible and need no JavaScript", () => {
  const ui = read("src/components/ui.tsx");
  assert.match(ui, /<details className="group relative/);
  assert.match(ui, /aria-label=\{`What is \$\{label\}\?`\}/);
  assert.match(ui, /aria-label=\{`Remove filter: \$\{c\.label\}`\}/);
  assert.match(ui, /aria-current=\{on \? "page" : undefined\}/);
  assert.ok(!/"use client"/.test(ui), "ui.tsx must stay a server module");
});

test("publisher detail page keeps its honesty notes and gets a sticky order card with the real order links", () => {
  const s = read("src/app/(marketing)/publishers/[domain]/page.tsx");
  assert.match(s, /lg:sticky/);
  assert.match(s, /\/dashboard\/orders\/new\?publisher=\$\{w\.id\}/);
  assert.match(s, /\/dashboard\/advice\/new\?publisher_id=\$\{w\.id\}/);
  assert.match(s, /does not guarantee rankings/);
  assert.match(s, /Nothing is charged until you submit payment details/);
  assert.match(s, /have not been checked by PostAtlas/);
  assert.match(s, /price_link_insertion/);
  assert.ok(!/<label[^>]*>[^<]*<HelpTip/.test(s));
});

import { orderProgress, PROGRESS_STEPS } from "../src/lib/order-progress.ts";

test("every order status has a position in the progress tracker, and it never moves backwards along the happy path", () => {
  const path = ["PAYMENT_PENDING", "PAYMENT_UNDER_REVIEW", "PAID", "CONTENT_SUBMITTED", "PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED", "MONITORING", "COMPLETED"];
  let last = -1;
  for (const st of path) { const p = orderProgress(st as never); assert.ok(p.step >= last, `${st} went backwards`); last = p.step; }
  for (const st of ALL) assert.ok(orderProgress(st as never).step >= -1, st);
  assert.equal(orderProgress("COMPLETED" as never).step, PROGRESS_STEPS.length, "completed means every step is done");
});

test("problem and ended orders are shown honestly", () => {
  for (const st of ["ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "DISPUTED"]) assert.equal(orderProgress(st as never).state, "attention", st);
  for (const st of ["CANCELLED", "PUBLISHER_REJECTED"]) assert.equal(orderProgress(st as never).state, "ended", st);
  assert.equal(orderProgress("VERIFICATION_PENDING" as never).step, 3, "a submitted URL is 'Published', not 'Live and monitored'");
  assert.equal(orderProgress("MONITORING" as never).step, 4);
});

test("customer order page shows the tracker and keeps its payment and article forms", () => {
  const s = read("src/app/dashboard/orders/[id]/page.tsx");
  assert.match(s, /<OrderProgress status=\{status\} \/>/);
  assert.match(s, /submitPayment/);
  assert.match(s, /submitArticle/);
  const ui = read("src/components/ui.tsx");
  assert.match(ui, /aria-label="Order progress"/);
  assert.match(ui, /aria-current=\{current \? "step" : undefined\}/);
});
