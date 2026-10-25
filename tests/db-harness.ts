// Executes the REAL fresh schema in an in-process PostgreSQL (PGlite) so financial rules are tested by running them,
// not by pattern-matching the SQL text. Supabase-only objects (auth schema, roles) are minimal stand-ins.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SCHEMA = process.env.PG_TEST_SCHEMA ? new URL("file://" + process.env.PG_TEST_SCHEMA) : new URL("../supabase/PostAtlas_fresh_supabase_schema.sql", import.meta.url);

export async function world() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema if not exists extensions;`);
  await db.exec(readFileSync(SCHEMA, "utf8").replace(/create extension[^;]*;/gi, ""));
  // Migration check: PG_TEST_UPGRADE=<file> applies a standalone upgrade file (twice, to prove it is idempotent) on top of PG_TEST_SCHEMA.
  if (process.env.PG_TEST_UPGRADE) { const up = readFileSync(process.env.PG_TEST_UPGRADE, "utf8"); await db.exec(up); await db.exec(up); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = async (sql: string, params: unknown[] = []): Promise<any[]> => (await db.query(sql, params)).rows;
  let n = 0;
  const user = async (email: string, role = "user") => {
    const id = randomUUID();
    await q("insert into auth.users(id,email) values($1,$2)", [id, email]);
    if (role !== "user") await q("update public.profiles set platform_role=$2 where id=$1", [id, role]);
    return id;
  };
  const admin = await user("admin@t.test", "super_admin");
  const cust = await user("c@t.test");
  const [org] = await q("insert into public.organizations(name) values('Org') returning id");
  await q("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')", [org.id, cust]);
  const [site] = await q("insert into public.websites(organization_id,domain,category,created_by) values($1,'cust.test','Technology',$2) returning id", [org.id, cust]);
  const [pm] = await q("insert into public.payment_methods(name,account_identifier,enabled,currencies) values('Bank','ACC123',true,'{USD,PKR}') returning id");

  const publisher = async (email: string, price: number, domain: string) => {
    const u = await user(email, "publisher");
    const [pp] = await q("insert into public.publisher_profiles(user_id,display_name) values($1,$2) returning id", [u, email]);
    const [l] = await q("insert into public.publisher_websites(publisher_id,domain,status,price_guest_post) values($1,$2,'approved',$3) returning id", [pp.id, domain, price]);
    return { user: u, profile: pp.id as string, listing: l.id as string };
  };
  const step = async (id: string, from: string, to: string, role = "admin") =>
    (await q("select public.transition_order($1,$2,$3,$4,$5) ok", [id, from, to, admin, role]))[0].ok as boolean;
  const walk = async (id: string, from: string, path: string[]) => { let prev = from; for (const s of path) { if (!(await step(id, prev, s))) throw new Error(`transition ${prev}->${s} refused`); prev = s; } };
  const placeOrder = async (listing: string) => {
    const price = Number((await q("select price_guest_post p from public.publisher_websites where id=$1", [listing]))[0].p);
    const [{ id }] = await q(`select public.create_order_priced($1,$2,$3,$4,null,'guest_post','https://cust.test/p','anchor','USD',$5,null,null,null,$6) id`, [org.id, cust, listing, site.id, pm.id, price]);
    const [{ id: pay }] = await q("select public.submit_payment($1,$2,$3,null) id", [id, cust, "REF" + ++n]);
    await q("select public.review_payment($1,$2,'approve',null)", [pay, admin]);
    return id as string;
  };
  const verifiedOrder = async (listing: string) => {
    const id = await placeOrder(listing);
    await walk(id, "PAID", ["CONTENT_SUBMITTED", "PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED"]);
    return id;
  };
  const obligation = async (orderId: string) => (await q("select public.create_payout_obligation($1, now()) id", [orderId]))[0].id as string;
  const verifiedDestination = async (publisherProfile: string, currency = "USD") =>
    (await q("insert into public.payout_destinations(publisher_id,currency,country,account_holder,bank_name,account_cipher,account_last4,status,verified_by,verified_at) values($1,$2,'US','Holder','Bank',$3,'1234','VERIFIED',$4,now()) returning id",
      [publisherProfile, currency, "v1." + "x".repeat(30), admin]))[0].id as string;
  const markPaid = (payout: string, amount = 98) =>
    q("select public.record_payout_result($1,$2,'paid','TRF-1','USD',$3,null,null,null,0,'bank statement line 42 ok',null) r", [payout, admin, amount]);
  /** An order whose link was lost: MONITORING -> ISSUE_DETECTED with an open restoration case. */
  const lostLink = async (orderId: string) => {
    await walk(orderId, "VERIFIED", ["MONITORING"]);
    await step(orderId, "MONITORING", "ISSUE_DETECTED", "system");
    return (await q("select public.open_recovery_case($1,'link_restoration','link lost',null,72) id", [orderId]))[0].id as string;
  };
  const reassign = (orderId: string, caseId: string, listing: string) => q("select public.reassign_order($1,$2,$3,$4,null)", [orderId, caseId, listing, admin]);
  return { db, q, admin, cust, publisher, placeOrder, verifiedOrder, obligation, verifiedDestination, markPaid, lostLink, reassign, walk, step };
}
