// Executes the REAL schema in PGlite (see db-harness.ts) to prove the deadline clock, the expired-order remedy and the review
// rules by running them. Needs `npm install` (PGlite) like tests/db-payouts.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { world } from "./db-harness.ts";

const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));
type W = Awaited<ReturnType<typeof world>>;

/** Pretend the clock ran out: the deadline columns are database-managed, so the test sets the flag the workflow uses. */
async function expire(w: W, orderId: string) {
  await w.q("select set_config('postatlas.deadline','1',false)");
  await w.q("update public.orders set due_at = now() - interval '1 hour' where id=$1", [orderId]);
  await w.q("select set_config('postatlas.deadline','',false)");
}
async function acceptedOrder(w: W, listing: string) {
  const id = await w.placeOrder(listing);
  await w.walk(id, "PAID", ["CONTENT_SUBMITTED", "PENDING_PUBLISHER", "ACCEPTED"]);
  return id;
}
const row = async (w: W, id: string) => (await w.q("select status, turnaround_hours, accepted_at, due_at, expiry_choice, extract(epoch from due_at - accepted_at)/3600 as window_h from public.orders where id=$1", [id]))[0];

test("the turnaround is snapshotted at order time and the clock starts only when the publisher accepts", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  await w.q("update public.publisher_websites set turnaround_days_max=2 where id=$1", [A.listing]);
  const id = await w.placeOrder(A.listing);
  let o = await row(w, id);
  assert.equal(o.turnaround_hours, 48); assert.equal(o.accepted_at, null); assert.equal(o.due_at, null);
  await w.q("update public.publisher_websites set turnaround_days_max=10 where id=$1", [A.listing]);        // later listing edit must not move it
  await w.walk(id, "PAID", ["CONTENT_SUBMITTED", "PENDING_PUBLISHER", "ACCEPTED"]);
  o = await row(w, id);
  assert.equal(o.turnaround_hours, 48); assert.ok(o.accepted_at && o.due_at); assert.equal(Number(o.window_h), 48);
  const due = o.due_at;
  await w.walk(id, "ACCEPTED", ["IN_PROGRESS"]);
  assert.deepEqual((await row(w, id)).due_at, due, "starting work must not reset the clock");
});

test("a listing without a stated turnaround gets the 7-day default", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.placeOrder(A.listing);
  assert.equal((await row(w, id)).turnaround_hours, 168);
});

test("the deadline fields cannot be edited directly, even by the service role", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const id = await acceptedOrder(w, A.listing);
  await rejects(w.q("update public.orders set due_at = now() + interval '1 year' where id=$1", [id]), /deadline fields/);
  await rejects(w.q("update public.orders set turnaround_hours = 1 where id=$1", [id]), /turnaround/);
  await rejects(w.q("update public.orders set expiry_choice = 'refund' where id=$1", [id]), /deadline fields/);
});

test("no remedy before the deadline; a non-member, or an order that was never paid, is refused", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const id = await acceptedOrder(w, A.listing);
  await rejects(w.q("select public.request_expiry_remedy($1,$2,'refund',null)", [id, w.cust]), /not past its delivery deadline/);
  await expire(w, id);
  const stranger = randomUUID(); await w.q("insert into auth.users(id,email) values($1,'x@t.test')", [stranger]);
  await rejects(w.q("select public.request_expiry_remedy($1,$2,'refund',null)", [id, stranger]), /role in this workspace/);
  await rejects(w.q("select public.request_expiry_remedy($1,$2,'bogus',null)", [id, w.cust]), /invalid choice/);
});

test("refund choice after the deadline: order closed for the publisher, case opened, refund REQUESTED (never completed), unpaid pay cancelled", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const id = await acceptedOrder(w, A.listing);
  await expire(w, id);
  await w.q("select public.request_expiry_remedy($1,$2,'refund','too slow')", [id, w.cust]);
  const o = await row(w, id);
  assert.equal(o.status, "PUBLISHER_REJECTED"); assert.equal(o.expiry_choice, "refund");
  const [c] = await w.q("select kind, status from public.recovery_cases where order_id=$1", [id]);
  assert.deepEqual([c.kind, c.status], ["publisher_timeout", "OPEN"]);
  const refunds = await w.q("select status, amount, requested_role from public.refunds where order_id=$1", [id]);
  assert.deepEqual(refunds.map((r) => [r.status, r.amount, r.requested_role]), [["REQUESTED", "100.00", "customer"]]);
  await rejects(w.q("select public.request_expiry_remedy($1,$2,'refund',null)", [id, w.cust]), /not past its delivery deadline/);   // idempotent: no second refund
  assert.equal((await w.q("select count(*)::int n from public.refunds where order_id=$1", [id]))[0].n, 1);
});

test("alternative choice: no refund is filed, admin reassigns on the same terms and the new publisher gets a fresh clock", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test"); const B = await w.publisher("b@t.test", 90, "b.test");
  await w.q("update public.publisher_websites set turnaround_days_max=3 where id=$1", [B.listing]);
  const id = await acceptedOrder(w, A.listing);
  await expire(w, id);
  const [{ request_expiry_remedy: cs }] = await w.q("select public.request_expiry_remedy($1,$2,'alternative',null)", [id, w.cust]);
  assert.equal((await w.q("select count(*)::int n from public.refunds where order_id=$1", [id]))[0].n, 0);
  await w.reassign(id, cs, B.listing);
  let o = await row(w, id);
  assert.equal(o.status, "PENDING_PUBLISHER"); assert.equal(o.expiry_choice, null); assert.equal(o.turnaround_hours, 72, "window follows the NEW listing");
  await w.walk(id, "PENDING_PUBLISHER", ["ACCEPTED"]);
  o = await row(w, id);
  assert.equal(Number(o.window_h), 72); assert.ok(new Date(o.due_at).getTime() > Date.now());
});

// ---- reviews ----------------------------------------------------------------------------------------------------------
async function withPlacement(w: W, orderId: string, publisherProfile: string, verified = true) {
  await w.q("insert into public.published_placements(order_id, published_url, submitted_by, health, verified_at) values($1,'https://a.test/p',$2,'HEALTHY',$3)", [orderId, publisherProfile, verified ? new Date().toISOString() : null]);
}

test("a review needs a verified placement, a buying member and a 1-5 rating; one per order; it belongs to the listing", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const early = await w.placeOrder(A.listing);
  await rejects(w.q("select public.submit_site_review($1,$2,5,'great')", [early, w.cust]), /published and verified/);

  const id = await w.verifiedOrder(A.listing); await withPlacement(w, id, A.profile);
  await rejects(w.q("select public.submit_site_review($1,$2,6,'x')", [id, w.cust]), /1 to 5/);
  await rejects(w.q("select public.submit_site_review($1,$2,0,null)", [id, w.cust]), /1 to 5/);
  const stranger = randomUUID(); await w.q("insert into auth.users(id,email) values($1,'s@t.test')", [stranger]);
  await rejects(w.q("select public.submit_site_review($1,$2,5,'great')", [id, stranger]), /role in this workspace/);

  await w.q("select public.submit_site_review($1,$2,4,'  Fast and friendly  ')", [id, w.cust]);
  const [r] = await w.q("select listing_id, rating, comment, status from public.site_reviews where order_id=$1", [id]);
  assert.deepEqual([r.listing_id, r.rating, r.comment, r.status], [A.listing, 4, "Fast and friendly", "published"]);
  await rejects(w.q("select public.submit_site_review($1,$2,5,null)", [id, w.cust]), /already been reviewed/);
  await rejects(w.q("insert into public.site_reviews(order_id,listing_id,organization_id,rating) select order_id,listing_id,organization_id,3 from public.site_reviews", []), /duplicate key|unique/);
});

test("a review is frozen; only moderation fields change; stats count published reviews only", async () => {
  const w = await world(); const A = await w.publisher("a@t.test", 100, "a.test");
  const id = await w.verifiedOrder(A.listing); await withPlacement(w, id, A.profile);
  await w.q("select public.submit_site_review($1,$2,5,null)", [id, w.cust]);
  await rejects(w.q("update public.site_reviews set rating=1 where order_id=$1", [id]), /cannot be edited/);
  await rejects(w.q("update public.site_reviews set comment='changed' where order_id=$1", [id]), /cannot be edited/);
  await rejects(w.q("delete from public.site_reviews where order_id=$1", [id]), /cannot be deleted/);
  assert.deepEqual((await w.q("select review_count, avg_rating from public.site_review_stats where listing_id=$1", [A.listing]))[0], { review_count: 1, avg_rating: "5.00" });
  const [{ id: rid }] = await w.q("select id from public.site_reviews where order_id=$1", [id]);
  await rejects(w.q("select public.moderate_site_review($1,$2,true,'x')", [rid, w.admin]), /reason is required/);
  await rejects(w.q("select public.moderate_site_review($1,$2,true,'abusive language')", [rid, w.cust]), /administrator/);
  await w.q("select public.moderate_site_review($1,$2,true,'abusive language')", [rid, w.admin]);
  assert.equal((await w.q("select count(*)::int n from public.site_review_stats where listing_id=$1", [A.listing]))[0].n, 0);
  await w.q("select public.moderate_site_review($1,$2,false,null)", [rid, w.admin]);
  assert.equal((await w.q("select review_count from public.site_review_stats where listing_id=$1", [A.listing]))[0].review_count, 1);
});

test("browser roles cannot run the new functions", async () => {
  const w = await world();
  for (const f of ["request_expiry_remedy(uuid,uuid,text,text)", "submit_site_review(uuid,uuid,int,text)", "moderate_site_review(uuid,uuid,boolean,text)"]) {
    const [p] = await w.q("select has_function_privilege('anon',$1,'execute') a, has_function_privilege('authenticated',$1,'execute') b, has_function_privilege('service_role',$1,'execute') c", [`public.${f}`]);
    assert.deepEqual([p.a, p.b, p.c], [false, false, true], f);
  }
});

test("the upgrade file applies on top of the fresh schema twice without error (idempotent)", async () => {
  // world() applies PG_TEST_UPGRADE twice when set; here we apply the file directly to prove re-running is harmless.
  const w = await world();
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/PostAtlas_upgrade_reviews_deadlines.sql", import.meta.url), "utf8");
  await w.db.exec(sql); await w.db.exec(sql);
});
