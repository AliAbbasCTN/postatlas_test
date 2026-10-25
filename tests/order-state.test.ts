import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canTransition, allowedTransitions, TRANSITION_RULES, TERMINAL_STATUSES, ORDER_STATUS_LABEL } from "../src/lib/order-state.ts";
import type { OrderStatus } from "../src/lib/types.ts";

test("customer cannot approve payment, accept, publish or verify", () => {
  assert.equal(canTransition("PAYMENT_UNDER_REVIEW", "PAID", "customer"), false);
  assert.equal(canTransition("PENDING_PUBLISHER", "ACCEPTED", "customer"), false);
  assert.equal(canTransition("IN_PROGRESS", "PUBLISHED", "customer"), false);
  assert.equal(canTransition("VERIFICATION_PENDING", "VERIFIED", "customer"), false);
});

test("publisher cannot approve payment or verify, and admin cannot accept for the publisher", () => {
  assert.equal(canTransition("PAYMENT_UNDER_REVIEW", "PAID", "publisher"), false);
  assert.equal(canTransition("VERIFICATION_PENDING", "VERIFIED", "publisher"), false);
  assert.equal(canTransition("PENDING_PUBLISHER", "ACCEPTED", "admin"), false);
});

test("only admin approves payments", () => {
  assert.equal(canTransition("PAYMENT_UNDER_REVIEW", "PAID", "admin"), true);
});

test("impossible jumps are rejected", () => {
  assert.equal(canTransition("PAYMENT_PENDING", "PAID", "admin"), false);
  assert.equal(canTransition("PAID", "PUBLISHED", "publisher"), false);
  assert.equal(canTransition("PAID", "MONITORING", "system"), false);
  assert.equal(canTransition("PENDING_PUBLISHER", "VERIFIED", "system"), false);
});

test("terminal states have no exits", () => {
  for (const s of TERMINAL_STATUSES) {
    for (const actor of ["customer", "publisher", "admin", "system"] as const) {
      assert.deepEqual(allowedTransitions(s, actor), []);
    }
  }
});

test("only admin can resolve a dispute", () => {
  assert.deepEqual(allowedTransitions("DISPUTED", "customer"), []);
  assert.deepEqual(allowedTransitions("DISPUTED", "publisher"), []);
  assert.ok(allowedTransitions("DISPUTED", "admin").length > 0);
});

test("rejected payment returns the order to payment pending", () => {
  assert.equal(canTransition("PAYMENT_UNDER_REVIEW", "PAYMENT_PENDING", "admin"), true);
});

test("every status has a customer label and a reachable path to a terminal state", () => {
  const all = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];
  for (const s of all) {
    const seen = new Set<OrderStatus>([s]);
    const queue: OrderStatus[] = [s];
    let reachesTerminal = TERMINAL_STATUSES.includes(s);
    while (queue.length && !reachesTerminal) {
      const cur = queue.shift()!;
      for (const r of TRANSITION_RULES.filter((r) => r.from === cur)) {
        if (TERMINAL_STATUSES.includes(r.to)) reachesTerminal = true;
        if (!seen.has(r.to)) { seen.add(r.to); queue.push(r.to); }
      }
    }
    assert.ok(reachesTerminal, `${s} cannot reach a terminal state`);
  }
});

test("database transition table matches the TypeScript rules exactly", () => {
  const sql = readFileSync(new URL("../supabase/PostAtlas_fresh_supabase_schema.sql", import.meta.url), "utf8");
  const block = sql.split("-- BEGIN order_status_transitions")[1]?.split("-- END order_status_transitions")[0] ?? "";
  const pairs = [...block.matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const expected = [...new Set(TRANSITION_RULES.map((r) => `${r.from}>${r.to}`))].sort();
  assert.deepEqual(pairs, expected);
});
