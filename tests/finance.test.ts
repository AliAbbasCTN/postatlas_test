import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { COMMISSION_BPS, priceBreakdown } from "../src/lib/money.ts";
import { canPayoutMove, canRefundMove, isOverdue, payoutGate, processByFor, refundableMinor, PAYOUT_PROCESSING_HOURS } from "../src/lib/payout-policy.ts";
import { encryptSecret, decryptSecret, last4, maskAccount, validateAccountNumber } from "../src/lib/crypto.ts";
import { canTransition } from "../src/lib/order-state.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const upgrade = read("supabase/PostAtlas_upgrade_marketplace_finance.sql");
const fresh = read("supabase/PostAtlas_fresh_supabase_schema.sql");
const fn = (sql: string, name: string) => { const i = sql.indexOf(`function public.${name}(`); assert.ok(i >= 0, `${name} missing`); return sql.slice(i, sql.indexOf("$$;", sql.indexOf("$$", i) + 2) + 3); };

// ---- pricing: TS and SQL must agree -------------------------------------------------------------------------------
test("the commission rate is 2% in both TypeScript and SQL", () => {
  assert.equal(COMMISSION_BPS, 200);
  assert.match(strip(upgrade), /function public\.commission_bps\(\)[\s\S]*?select 200/);
});
test("the pricing snapshot table re-derives commission, net, no-markup and the converted amount", () => {
  const sql = strip(upgrade);
  assert.match(sql, /customer_base_usd = list_price_usd/);
  assert.match(sql, /commission_usd = round\(list_price_usd \* commission_bps \/ 10000\.0, 2\)/);
  assert.match(sql, /publisher_net_usd = list_price_usd - commission_usd/);
  assert.match(sql, /amount_due = round\(list_price_usd \* fx_rate, 0\)/);
});
test("the pricing snapshot is immutable except through the audited correction function", () => {
  const sql = strip(upgrade);
  assert.match(sql, /create trigger order_pricing_guard_trg before update or delete on public\.order_pricing/);
  assert.match(fn(sql, "admin_correct_checkout"), /assert_admin[\s\S]*PAYMENT_PENDING[\s\S]*pricing_correction[\s\S]*order_events/);
});
test("order creation derives the price in the database and rejects a mismatching client calculation", () => {
  const f = fn(strip(upgrade), "create_order_priced");
  assert.match(f, /price_guest_post[\s\S]*price_link_insertion/);
  assert.match(f, /p_expected_due is distinct from due[\s\S]*checkout amount mismatch/);
  assert.match(f, /m\.enabled and p_currency = any \(m\.currencies\)/);
  assert.match(f, /interval '48 hours'/);
  const action = read("src/lib/actions/orders.ts");
  assert.ok(!/customer_price:\s*price/.test(action), "createOrder must not insert a price itself");
  assert.match(action, /rpc\("create_order_priced"/);
  assert.match(action, /lockCheckout\(/);
  assert.ok(!/formData\.get\("(price|amount|commission|fx_rate|rate)"\)/.test(action), "no money value may be read from the browser");
});
test("worked examples agree with the contract the SQL enforces", () => {
  for (const [list, comm, net] of [[100, 200n, 9800n], [250, 500n, 24500n]] as const) { const b = priceBreakdown(String(list)); assert.equal(b.commissionMinor, comm); assert.equal(b.publisherNetMinor, net); }
});

// ---- payments ------------------------------------------------------------------------------------------------------------
test("payments are submitted and reviewed through atomic, locking database functions", () => {
  const sub = fn(strip(upgrade), "submit_payment"); const rev = fn(strip(upgrade), "review_payment");
  assert.match(sub, /from public\.orders where id = p_order for update/);
  assert.match(sub, /transition_order\(p_order, 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW'/);
  assert.match(rev, /assert_admin\(p_admin\)/);
  assert.match(rev, /for update[\s\S]*for update/, "locks the order and the payment");
  assert.match(rev, /already been reviewed/);
  assert.match(rev, /ledger_add\([^)]*customer_payment_confirmed/);
  const pay = read("src/lib/actions/payments.ts");
  assert.match(pay, /rpc\("submit_payment"/); assert.match(pay, /rpc\("review_payment"/);
  assert.ok(!/from\("payments"\)\.(insert|update)/.test(pay), "payments must not be written outside the RPCs");
});
test("payment rows can only carry the locked amount, currency and method; one confirmed payment per order; unique references", () => {
  const g = fn(strip(upgrade), "payments_guard");
  assert.match(g, /new\.amount <> snap\.amount_due or new\.currency <> snap\.checkout_currency/);
  assert.match(g, /payment method chosen at checkout/);
  assert.match(strip(upgrade), /create unique index if not exists payments_one_paid on public\.payments \(order_id\) where status = 'PAID'/);
  assert.match(strip(fresh), /payments_reference_unique/);
});
test("payment methods carry currencies; existing methods default to USD only", () => {
  assert.match(strip(upgrade), /add column if not exists currencies text\[\] not null default array\['USD'\]/);
});
test("a submitted reference is never treated as money received (payment states are distinct)", () => {
  assert.equal(canTransition("PAYMENT_PENDING", "PAID", "admin"), false);
  assert.equal(canTransition("PAYMENT_UNDER_REVIEW", "PAID", "customer"), false);
  assert.equal(canTransition("PAYMENT_UNDER_REVIEW", "PAID", "admin"), true);
});

// ---- publisher rejection / restoration ------------------------------------------------------------------------------------
test("a paid order declined by its publisher can be reassigned, and never silently completes or refunds", () => {
  assert.equal(canTransition("PUBLISHER_REJECTED", "PENDING_PUBLISHER", "admin"), true);
  assert.equal(canTransition("PUBLISHER_REJECTED", "PENDING_PUBLISHER", "publisher"), false);
  assert.equal(canTransition("PUBLISHER_REJECTED", "PAID", "admin"), false);
  assert.equal(canTransition("REPLACEMENT_REQUESTED", "PENDING_PUBLISHER", "admin"), true);
  const src = read("src/lib/actions/fulfillment.ts");
  const reject = src.slice(src.indexOf("export async function rejectOrder"), src.indexOf("export async function startWork"));
  assert.match(reject, /openRejectionCase\(/);
  assert.ok(!/rpc\("request_refund"|from\("refunds"\)|record_refund_result/.test(reject), "rejection must not itself create or complete a refund");
});
test("reassigning keeps the customer's price and terms, and cancels what an unfulfilling publisher is owed", () => {
  const f = fn(strip(upgrade), "reassign_order");
  assert.match(f, /assert_admin/);
  assert.match(f, /update public\.orders set website_id = p_new_listing/);
  assert.ok(!/customer_price|order_pricing/.test(f.replace(/order_pricing/g, "")) || !/update public\.order_pricing/.test(f));
  assert.match(f, /cancel_unpaid_payouts/);
  assert.match(f, /lst\.publisher_id = c\.original_publisher_id[\s\S]*choose a different publisher/);
  assert.match(strip(upgrade), /the publisher listing can only be changed by reassign_order\(\)/);
});
test("one open recovery case per order and kind", () => {
  assert.match(strip(upgrade), /create unique index if not exists recovery_one_open on public\.recovery_cases \(order_id, kind\) where status in \('OPEN', 'REASSIGNED', 'ESCALATED'\)/);
});
test("a confirmed link loss opens a restoration case; a restoration closes it; neither touches the original payout", () => {
  const src = read("src/lib/services/placements.ts");
  assert.match(src, /openRestorationCase\(order\.id/);
  assert.match(src, /rpc\("mark_case_restored"/);
  const f = fn(strip(upgrade), "mark_case_restored");
  assert.ok(!/publisher_payouts/.test(f));
});

// ---- payouts --------------------------------------------------------------------------------------------------------------
test("12-hour processing target is computed from the verification time", () => {
  assert.equal(PAYOUT_PROCESSING_HOURS, 12);
  assert.equal(processByFor("2026-10-10T00:00:00.000Z"), "2026-10-10T12:00:00.000Z");
  assert.match(strip(upgrade), /p_verified_at \+ interval '12 hours'/);
});
test("one fulfilment payout per order and one replacement per case, enforced by unique indexes; cron repeats are idempotent", () => {
  const sql = strip(upgrade);
  assert.match(sql, /publisher_payouts_one_fulfillment on public\.publisher_payouts \(order_id\) where kind = 'fulfillment' and status <> 'CANCELLED'/);
  assert.match(sql, /publisher_payouts_one_replacement on public\.publisher_payouts \(recovery_case_id\) where kind = 'replacement'/);
  const f = fn(sql, "create_payout_obligation");
  assert.match(f, /an unpaid order cannot create a payout obligation/);
  assert.match(f, /only a verified placement creates a payout obligation/);
  // Idempotency is proven by executing the function (tests/db-payouts.test.ts); this only pins the mechanism.
  assert.match(f, /publisher_id = lst\.publisher_id and status <> 'CANCELLED'[\s\S]*?if mine\.id is not null then return mine\.id/);
  assert.match(f, /a payout cannot exceed the original order budget/);
  assert.match(fn(sql, "start_due_payouts"), /for update skip locked/);
  assert.match(fn(sql, "ledger_add"), /on conflict \(idempotency_key\) do nothing/);
});
test("an unfulfilled publisher never receives fulfilment pay: obligations exist only after verification and are cancelled on rejection/refund", () => {
  const sql = strip(upgrade);
  assert.match(fn(sql, "cancel_unpaid_payouts"), /status in \('ELIGIBLE', 'HELD', 'FAILED'\)/);
  assert.match(fn(sql, "record_refund_result"), /cancel_unpaid_payouts/);
  const placements = read("src/lib/services/placements.ts");
  assert.ok(placements.indexOf("onPlacementVerified") > 0);
});
test("a payout cannot be PAID without a reference, evidence, amount, destination currency and confirming admin", () => {
  const sql = strip(upgrade);
  assert.match(sql, /publisher_payouts_paid_needs_proof/);
  const f = fn(sql, "record_payout_result");
  assert.match(f, /assert_admin/);
  assert.match(f, /a paid payout needs a transfer reference and evidence/);
  assert.match(f, /payout currency must match the destination account currency/);
  assert.match(f, /a PKR payout needs the exchange rate used/);
});
test("failed payouts retry; uncertain payouts must be reconciled first", () => {
  assert.equal(canPayoutMove("FAILED", "ELIGIBLE"), true);
  assert.equal(canPayoutMove("UNCERTAIN", "PROCESSING"), false);
  assert.equal(canPayoutMove("UNCERTAIN", "ELIGIBLE"), false);
  assert.equal(canPayoutMove("UNCERTAIN", "PAID"), true);
  assert.equal(canPayoutMove("PAID", "PROCESSING"), false);
  assert.match(fn(strip(upgrade), "retry_payout"), /must be reconciled before it can be retried/);
});
test("holds: disputes and open refunds keep payouts out of the queue", () => {
  assert.deepEqual(payoutGate({ openDispute: true, openRefund: false, hasVerifiedDestination: true, orderPaid: true }).ok, false);
  assert.deepEqual(payoutGate({ openDispute: false, openRefund: true, hasVerifiedDestination: true, orderPaid: true }).ok, false);
  assert.deepEqual(payoutGate({ openDispute: false, openRefund: false, hasVerifiedDestination: false, orderPaid: true }).ok, false);
  assert.deepEqual(payoutGate({ openDispute: false, openRefund: false, hasVerifiedDestination: true, orderPaid: false }).ok, false);
  assert.deepEqual(payoutGate({ openDispute: false, openRefund: false, hasVerifiedDestination: true, orderPaid: true }).ok, true);
  assert.match(fn(strip(upgrade), "start_due_payouts"), /disputes[\s\S]*refunds[\s\S]*'HELD'/);
  assert.match(read("src/lib/actions/disputes.ts"), /rpc\("hold_payouts_for_order"/);
});
test("overdue detection", () => {
  const now = new Date("2026-10-10T13:00:00Z");
  assert.equal(isOverdue({ status: "ELIGIBLE", process_by: "2026-10-10T12:00:00Z" }, now), true);
  assert.equal(isOverdue({ status: "ELIGIBLE", process_by: "2026-10-10T14:00:00Z" }, now), false);
  assert.equal(isOverdue({ status: "PAID", process_by: "2026-10-10T12:00:00Z" }, now), false);
});
test("the payout row cannot be altered after it is paid or cancelled, and its entitlement never changes", () => {
  const g = fn(strip(upgrade), "payouts_guard");
  assert.match(g, /old\.status in \('PAID', 'CANCELLED', 'PROCESSED'\)/);
  assert.match(g, /new\.amount is distinct from old\.amount/);
});

// ---- refunds -------------------------------------------------------------------------------------------------------------
test("refunds cannot exceed the amount paid and cannot be completed without a real reference and evidence", () => {
  assert.equal(refundableMinor(10000n, 4000n), 6000n);
  assert.equal(refundableMinor(10000n, 12000n), 0n);
  const req = fn(strip(upgrade), "request_refund");
  assert.match(req, /for update/);
  assert.match(req, /v_amount \+ v_live > pay\.amount[\s\S]*would exceed the amount paid/);
  assert.match(req, /idempotency_key/);
  const rec = fn(strip(upgrade), "record_refund_result");
  assert.match(rec, /a completed refund needs a real transfer reference and evidence/);
  assert.match(strip(upgrade), /refunds_completed_needs_proof/);
});
test("refund workflow states and transitions", () => {
  assert.equal(canRefundMove("REQUESTED", "COMPLETED"), false);
  assert.equal(canRefundMove("APPROVED", "COMPLETED"), false);
  assert.equal(canRefundMove("PROCESSING", "COMPLETED"), true);
  assert.equal(canRefundMove("UNCERTAIN", "PROCESSING"), false);
  assert.equal(canRefundMove("COMPLETED", "PROCESSING"), false);
});
test("cancelling an order never completes a refund; it only opens a request", () => {
  const src = read("src/lib/actions/fulfillment.ts");
  const adm = src.slice(src.indexOf("export async function adminSetOrderStatus"));
  assert.match(adm, /rpc\("request_refund"/);
  assert.ok(!/record_refund_result|'COMPLETED'|status: "COMPLETED"/.test(adm.slice(0, adm.indexOf("logAudit"))));
  assert.match(fn(strip(upgrade), "record_refund_result"), /v_done >= pay\.amount/);   // order cancels only after a COMPLETED full refund
});

// ---- ledger, grants, RLS --------------------------------------------------------------------------------------------------
test("the ledger is append-only and idempotent", () => {
  const sql = strip(upgrade);
  assert.match(sql, /create trigger ledger_append_only before update or delete on public\.ledger_entries/);
  assert.match(sql, /idempotency_key text not null unique/);
});
test("every new database function is service-role only, pins search_path, and administrative ones check the caller", () => {
  const sql = strip(upgrade);
  for (const m of sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns/g)) {
    const body = fn(sql, m[1]);
    if (/security definer/.test(sql.slice(m.index, m.index + 900))) assert.match(sql.slice(m.index, m.index + 900), /set search_path = ''/, m[1]);
    void body;
  }
  assert.match(sql, /revoke all on function public\.%s from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.%s to service_role/);
  for (const f of ["review_payment", "reassign_order", "resolve_recovery_case", "record_payout_result", "retry_payout", "advance_refund", "record_refund_result", "admin_correct_checkout"]) assert.match(fn(sql, f), /assert_admin\(p_admin\)/, f);
});
test("sensitive tables have RLS enabled and no browser policies; only the order snapshot is readable, by its members", () => {
  const sql = strip(upgrade);
  for (const t of ["fx_rates", "order_pricing", "ledger_entries", "payout_destinations", "recovery_cases", "refunds"]) assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`));
  assert.ok(!/create policy [\s\S]*? on public\.(payout_destinations|ledger_entries|refunds|recovery_cases|fx_rates|publisher_payouts)\b/.test(sql));
  assert.match(sql, /grant select on public\.order_pricing to authenticated/);
  assert.match(sql, /revoke all on public\.fx_rates, public\.order_pricing, public\.ledger_entries, public\.payout_destinations, public\.recovery_cases, public\.refunds from anon, authenticated/);
});
test("the fresh schema contains the whole finance upgrade", () => {
  for (const f of ["create_order_priced", "review_payment", "create_payout_obligation", "reassign_order", "record_refund_result", "orders_missing_payout_obligation"]) assert.match(fresh, new RegExp(`function public\\.${f}\\(`));
  assert.match(fresh, /\('PUBLISHER_REJECTED', 'PENDING_PUBLISHER'\)/);
});
test("the upgrade is additive: nothing dropped or deleted", () => {
  const sql = strip(upgrade);
  assert.ok(!/drop\s+table|truncate|delete\s+from|drop\s+column/i.test(sql));
});

// ---- secrets and exposure ---------------------------------------------------------------------------------------------------
test("payout account numbers are encrypted, round-trip, tamper-evident, and masked for display", () => {
  process.env.PAYOUT_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
  const acct = validateAccountNumber("PK36 SCBL 0000 0011 2345 6702", "PKR");
  const token = encryptSecret(acct);
  assert.ok(!token.includes(acct));
  assert.equal(decryptSecret(token), acct);
  assert.notEqual(encryptSecret(acct), token);                                   // fresh IV each time
  assert.throws(() => decryptSecret(token.slice(0, -2) + "AA"));
  assert.equal(maskAccount(last4(acct)), "•••• 6702");
  for (const bad of ["abc", "12", "<script>", ""]) assert.throws(() => validateAccountNumber(bad, "USD"));
  delete process.env.PAYOUT_DATA_KEY;
  assert.throws(() => encryptSecret("x"));
});
test("no server action file exports a function that returns bank details or accepts an actor id from the browser", () => {
  const dir = new URL("../src/lib/actions/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/decryptSecret/.test(src), `${f} must not decrypt payout data`);
    for (const m of src.matchAll(/export async function (\w+)\(([^)]*)\)/g)) assert.ok(!/(adminId|actorId|userId)\s*:/.test(m[2]), `${f}:${m[1]} takes an identity as a parameter`);
  }
  assert.match(read("src/lib/services/destinations.ts"), /import "server-only"/);
});
test("finance admin actions are admin-only; publisher settings are publisher-only; amounts are never read from forms", () => {
  const admin = read("src/lib/actions/finance-admin.ts");
  for (const m of admin.matchAll(/export async function (\w+)\(/g)) {
    const body = admin.slice(m.index, admin.indexOf("\nexport async function", m.index + 10) > 0 ? admin.indexOf("\nexport async function", m.index + 10) : undefined);
    assert.match(body, /actionAdmin\(\)/, m[1]);
  }
  assert.match(read("src/lib/actions/payout-settings.ts"), /actionPublisher\(\)/);
  assert.match(read("src/lib/actions/payment-methods.ts").slice(read("src/lib/actions/payment-methods.ts").indexOf("setMethodCurrencies")), /actionSuperAdmin\(\)/);
  assert.ok(!/formData\.get\("(commission|entitlement|status)"\)/.test(admin));
});
test("secrets and log hygiene: finance code never logs references, account numbers or ciphertext", () => {
  for (const p of ["src/lib/actions/finance-admin.ts", "src/lib/actions/payout-settings.ts", "src/lib/services/payouts.ts"]) {
    const src = read(p);
    for (const m of src.matchAll(/console\.(log|error)\(([^)]*)\)/g)) assert.ok(!/reference|account|cipher|evidence|swift/i.test(m[2]), `${p}: ${m[0]}`);
  }
});

// ---- scheduling ---------------------------------------------------------------------------------------------------------------
test("cron routes are secret-protected with constant-time comparison and scheduled", () => {
  for (const r of ["src/app/api/cron/finance/route.ts", "src/app/api/cron/monitor/route.ts"]) { const s = read(r); assert.match(s, /CRON_SECRET/); assert.match(s, /timingSafeEqual/); assert.match(s, /notifyStaff/); }
  const v = JSON.parse(read("vercel.json"));
  assert.deepEqual(v.crons.map((c: { path: string }) => c.path).sort(), ["/api/cron/finance", "/api/cron/monitor"]);
});
test("exchange-rate service never invents a value and the checkout path enforces the stale-rate policy", () => {
  const fx = read("src/lib/services/fx.ts");
  assert.match(fx, /if \(!row\) return null/);
  assert.match(fx, /classifyFreshness/);
  const fin = read("src/lib/services/finance.ts");
  assert.match(fin, /checkoutAllowed/);
  assert.match(fin, /does not accept \$\{currency\}/);
});
