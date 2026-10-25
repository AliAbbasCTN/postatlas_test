import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./db-harness.ts";

const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));

test("pricing in the database: customer pays the list price, commission 2%, publisher net 98%", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.placeOrder(A.listing);
  const [p] = await w.q("select customer_base_usd, list_price_usd, commission_usd, publisher_net_usd, commission_bps from public.order_pricing where order_id=$1", [id]);
  assert.deepEqual([p.customer_base_usd, p.list_price_usd, p.commission_usd, p.publisher_net_usd, p.commission_bps], ["100.00", "100.00", "2.00", "98.00", 200]);
});

test("a fulfilment payout is created once; repeating the call returns the same payout (idempotent, no error)", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing);
  const first = await w.obligation(id);
  assert.equal(await w.obligation(id), first);
  assert.equal(await w.obligation(id), first);
  const rows = await w.q("select kind, amount, status, (extract(epoch from process_by - verified_at) / 3600)::int as lead_hours from public.publisher_payouts where order_id=$1", [id]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].amount, rows[0].status], ["fulfillment", "98.00", "ELIGIBLE"]);
  assert.equal(rows[0].lead_hours, 12, "processing target is 12h after verification");
});

test("an unpaid or unverified order cannot create a payout obligation", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const paidOnly = await w.placeOrder(A.listing);
  await rejects(w.obligation(paidOnly), /only a verified placement/);
});

test("the database refuses a second live fulfilment payout for an order", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing); await w.obligation(id);
  await rejects(w.q("insert into public.publisher_payouts(publisher_id,order_id,amount,kind,status) values($1,$2,98,'fulfillment','ELIGIBLE')", [A.profile, id]), /duplicate key|publisher_payouts_one_fulfillment/);
});

test("the original publisher restoring a lost link does not create a second payout or change their pay", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing); const original = await w.obligation(id);
  await w.lostLink(id);
  await w.step(id, "ISSUE_DETECTED", "MONITORING", "system");                         // link restored and re-verified
  assert.equal(await w.obligation(id), original);
  const rows = await w.q("select amount from public.publisher_payouts where order_id=$1 and status<>'CANCELLED'", [id]);
  assert.deepEqual(rows.map((r) => r.amount), ["98.00"]);
});

test("reassignment is refused when the replacement costs more than the original budget", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const B = await w.publisher("b@t.test", 150, "b.test");
  const id = await w.verifiedOrder(A.listing); await w.obligation(id); const cs = await w.lostLink(id);
  await rejects(w.reassign(id, cs, B.listing), /costs more than the original order budget/);
  assert.equal((await w.q("select website_id from public.orders where id=$1", [id]))[0].website_id, A.listing, "order unchanged after refusal");
});

test("reassignment within budget cancels the original's UNPAID entitlement; replacement pay is fixed at reassignment time", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const B = await w.publisher("b@t.test", 90, "b.test");
  const id = await w.verifiedOrder(A.listing); const orig = await w.obligation(id); const cs = await w.lostLink(id);
  await w.reassign(id, cs, B.listing);
  assert.equal((await w.q("select status from public.publisher_payouts where id=$1", [orig]))[0].status, "CANCELLED");
  await w.walk(id, "PENDING_PUBLISHER", ["ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED"]);
  await w.q("update public.publisher_websites set price_guest_post=400 where id=$1", [B.listing]);   // publisher raises their price AFTER assignment
  const repl = await w.obligation(id);
  const [p] = await w.q("select amount, publisher_id from public.publisher_payouts where id=$1", [repl]);
  assert.equal(p.amount, "88.20", "98% of the price agreed at reassignment ($90), unaffected by the later $400 listing price");
  assert.equal(p.publisher_id, B.profile);
  assert.equal(await w.obligation(id), repl, "repeat is idempotent");
  const [{ total }] = await w.q("select sum(amount) total from public.publisher_payouts where order_id=$1 and status<>'CANCELLED'", [id]);
  assert.ok(Number(total) <= 98, `live payouts ${total} must not exceed the original entitlement of 98.00`);
});

test("when the original was already PAID, the replacement is PostAtlas's cost: original unchanged, replacement capped, cost recorded", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const B = await w.publisher("b@t.test", 100, "b.test");
  const id = await w.verifiedOrder(A.listing); const orig = await w.obligation(id);
  await w.verifiedDestination(A.profile); await w.q("select * from public.start_due_payouts(10)"); await w.markPaid(orig);
  const cs = await w.lostLink(id); await w.reassign(id, cs, B.listing);
  assert.equal((await w.q("select status, amount from public.publisher_payouts where id=$1", [orig]))[0].status, "PAID");
  await w.walk(id, "PENDING_PUBLISHER", ["ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED"]);
  const repl = await w.obligation(id);
  const [p] = await w.q("select kind, amount from public.publisher_payouts where id=$1", [repl]);
  assert.deepEqual([p.kind, p.amount], ["replacement", "98.00"]);
  assert.equal((await w.q("select amount from public.publisher_payouts where id=$1", [orig]))[0].amount, "98.00", "original compensation did not change");
  const cost = await w.q("select amount from public.ledger_entries where order_id=$1 and kind='replacement_cost'", [id]);
  assert.deepEqual(cost.map((r) => r.amount), ["98.00"]);
  assert.equal(await w.obligation(id), repl);
});

test("the replacement payout can never exceed the order budget even for a legacy case without a stored snapshot", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const B = await w.publisher("b@t.test", 90, "b.test");
  const id = await w.verifiedOrder(A.listing); await w.obligation(id); const cs = await w.lostLink(id);
  await w.reassign(id, cs, B.listing);
  await w.q("update public.recovery_cases set replacement_list_price_usd=null, replacement_entitlement_usd=null where id=$1", [cs]);  // simulate a pre-fix case
  await w.walk(id, "PENDING_PUBLISHER", ["ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED"]);
  await w.q("update public.publisher_websites set price_guest_post=400 where id=$1", [B.listing]);
  const [p] = await w.q("select amount from public.publisher_payouts where id=$1", [await w.obligation(id)]);
  assert.equal(p.amount, "98.00", "live price 400 is capped at the $100 budget (98.00 net)");
});

test("the queue never starts a payout without a verified destination, starts it exactly once, and never repeats", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing); const p = await w.obligation(id);
  assert.equal((await w.q("select * from public.start_due_payouts(10)")).length, 0);
  let [row] = await w.q("select status, last_error from public.publisher_payouts where id=$1", [p]);
  assert.deepEqual([row.status, row.last_error], ["ELIGIBLE", "No verified payout destination"]);
  await w.q("insert into public.payout_destinations(publisher_id,currency,country,account_holder,bank_name,account_cipher,account_last4) values($1,'USD','US','Holder','Bank',$2,'1234')", [A.profile, "v1." + "x".repeat(30)]);
  assert.equal((await w.q("select * from public.start_due_payouts(10)")).length, 0, "an UNVERIFIED destination is not enough");
  await w.q("update public.payout_destinations set status='VERIFIED', verified_by=$2, verified_at=now() where publisher_id=$1", [A.profile, w.admin]);
  assert.equal((await w.q("select * from public.start_due_payouts(10)")).length, 1);
  assert.equal((await w.q("select * from public.start_due_payouts(10)")).length, 0, "second run finds nothing to start");
  [row] = await w.q("select status, attempts from public.publisher_payouts where id=$1", [p]);
  assert.deepEqual([row.status, row.attempts], ["PROCESSING", 1]);
});

test("PAID needs a real reference and evidence, is final, and an UNCERTAIN transfer cannot be blindly retried", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing); const p = await w.obligation(id);
  await w.verifiedDestination(A.profile); await w.q("select * from public.start_due_payouts(10)");
  await rejects(w.q("select public.record_payout_result($1,$2,'paid','','USD',98,null,null,null,0,'short',null)", [p, w.admin]), /needs a transfer reference and evidence/);
  await w.q("select public.record_payout_result($1,$2,'uncertain',null,'USD',null,null,null,null,0,null,'timeout')", [p, w.admin]);
  await rejects(w.q("select public.retry_payout($1,$2)", [p, w.admin]), /must be reconciled/);
  await w.markPaid(p);
  await rejects(w.q("update public.publisher_payouts set status='ELIGIBLE' where id=$1", [p]), /cannot be changed/);
  await rejects(w.markPaid(p), /cannot be settled/);
  assert.equal((await w.q("select count(*)::int n from public.ledger_entries where kind='payout_paid' and order_id=$1", [id]))[0].n, 1, "exactly one payout ledger entry");
});

test("a held payout is not started until released", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing); const p = await w.obligation(id); await w.verifiedDestination(A.profile);
  await w.q("select public.hold_payouts_for_order($1,$2,'admin','suspected fraud')", [id, w.admin]);
  assert.equal((await w.q("select * from public.start_due_payouts(10)")).length, 0);
  await w.q("select public.release_payouts_for_order($1,$2,'admin')", [id, w.admin]);
  assert.equal((await w.q("select * from public.start_due_payouts(10)")).length, 1);
  assert.equal((await w.q("select status from public.publisher_payouts where id=$1", [p]))[0].status, "PROCESSING");
});

test("replace_payout_destination is atomic: one active destination per currency, the new one needs verification", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const old = await w.verifiedDestination(A.profile);
  const [{ id: fresh }] = await w.q("select public.replace_payout_destination($1,'USD','US','New Holder','New Bank','ABCDUS33',$2,'9999') id", [A.profile, "v1." + "y".repeat(30)]);
  const rows = await w.q("select id, status from public.payout_destinations where publisher_id=$1 order by created_at", [A.profile]);
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [[old, "DISABLED"], [fresh, "PENDING_VERIFICATION"]]);
  await rejects(w.q("select public.replace_payout_destination($1,'USD','US','H','B',null,$2,'1')", [randomUuidNotFound(), "v1." + "z".repeat(30)]), /publisher not found/);
});
function randomUuidNotFound() { return "00000000-0000-4000-8000-000000000000"; }
