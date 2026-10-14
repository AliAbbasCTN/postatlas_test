import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { reviewDestination, recordPayout, retryPayout, holdOrReleasePayouts, cancelPayoutEntitlement } from "@/lib/actions/finance-admin";
import { revealDestinationForAdmin } from "@/lib/services/destinations";
import { formatUsd } from "@/lib/money";
import { isOverdue } from "@/lib/payout-policy";
import { payoutEncryptionConfigured } from "@/lib/crypto";
import Link from "next/link";

export const metadata = { title: "Payouts" };

export default async function AdminPayouts({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; reveal?: string }> }) {
  const sp = await searchParams;
  const { user } = await requireAdmin();
  const db = createAdminClient();
  const [{ data: pending }, { data: queue }, { data: recent }, { data: pubs }, { data: verifiedDests }] = await Promise.all([
    db.from("payout_destinations").select("id, currency, country, account_holder, bank_name, account_last4, swift_bic, created_at, publisher_profiles(user_id)").eq("status", "PENDING_VERIFICATION").order("created_at").limit(50),
    db.from("publisher_payouts").select("id, order_id, amount, kind, status, process_by, hold_reason, last_error, attempts, destination_id, payout_destinations(currency, bank_name, account_last4, account_holder), publisher_profiles(display_name)").in("status", ["ELIGIBLE", "HELD", "PROCESSING", "UNCERTAIN", "FAILED"]).order("process_by", { nullsFirst: false }).limit(100),
    db.from("publisher_payouts").select("id, order_id, amount, status, payout_currency, payout_amount, confirmed_at, provider_reference, publisher_profiles(display_name)").eq("status", "PAID").order("confirmed_at", { ascending: false }).limit(25),
    db.from("publisher_profiles").select("id, display_name").eq("approved", true).limit(500),
    db.from("payout_destinations").select("publisher_id").eq("status", "VERIFIED").limit(1000)
  ]);
  const verifiedIds = new Set((verifiedDests ?? []).map((d: { publisher_id: string }) => d.publisher_id));
  const incomplete = (pubs ?? []).filter((p: { id: string }) => !verifiedIds.has(p.id)) as { id: string; display_name: string }[];
  // A full account number is shown only on explicit request, only to an admin, only for a VERIFIED destination, and each reveal is audited.
  const reveal = sp.reveal && /^[0-9a-f-]{36}$/i.test(sp.reveal) ? await revealDestinationForAdmin(sp.reveal, user.id) : null;
  const rows: any[] = queue ?? [];
  return (
    <div>
      <PageHeader title="Publisher payouts" subtitle="No automatic payout provider is connected. An administrator makes each bank transfer, then records the real reference here. Nothing is marked paid until you do." />
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />
      {!payoutEncryptionConfigured() && <p role="alert" className="card border-redsig text-sm text-redsig mb-6"><b>Payout details cannot be saved.</b> <code>PAYOUT_DATA_KEY</code> is missing or not 32 random bytes in base64, so publishers see "temporarily unavailable" and cannot add bank details. Generate one with <code>node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"</code>, add it to the server environment and redeploy. Keep a backup: losing it makes saved details unreadable.</p>}
      <details className="card mb-6 text-sm"><summary className="cursor-pointer font-semibold">Approved publishers without a verified payout method ({incomplete.length})</summary>
        {incomplete.length === 0 ? <p className="mt-2 text-inksoft">Every approved publisher has a verified payout method.</p> : <ul className="mt-2 grid gap-1">{incomplete.map((p) => <li key={p.id}>{p.display_name} <span className="text-xs text-inksoft">· cannot be paid yet</span></li>)}</ul>}
      </details>

      <h2 className="font-serif font-semibold text-xl mb-3">Payout details waiting for verification</h2>
      {(pending ?? []).length === 0 ? <p className="text-sm text-inksoft mb-8">None.</p> : (
        <ul className="grid gap-3 mb-8">{(pending as any[]).map((d) => (
          <li key={d.id} className="card text-sm"><div><b>{d.account_holder}</b> · {d.bank_name} · {d.currency} · {d.country} · account •••• {d.account_last4}{d.swift_bic ? ` · ${d.swift_bic}` : ""}</div><div className="text-xs text-inksoft">Added {fmtDateTime(d.created_at)}. Verify the account with the bank or the publisher before approving.</div>
            <div className="flex flex-wrap gap-3 mt-3">
              <form action={reviewDestination}><input type="hidden" name="destination_id" value={d.id} /><input type="hidden" name="decision" value="verify" /><button className="btn-primary">Mark verified</button></form>
              <form action={reviewDestination} className="flex gap-2"><input type="hidden" name="destination_id" value={d.id} /><input type="hidden" name="decision" value="disable" /><input name="reason" required minLength={3} maxLength={300} placeholder="Reason" className="input w-56" /><button className="btn-danger">Reject</button></form>
            </div></li>))}</ul>)}

      <h2 className="font-serif font-semibold text-xl mb-3">Payout queue</h2>
      {rows.length === 0 ? <EmptyState title="No open payouts" /> : (
        <ul className="grid gap-4 mb-8">{rows.map((p) => { const d = Array.isArray(p.payout_destinations) ? p.payout_destinations[0] : p.payout_destinations; return (
          <li key={p.id} className="card text-sm">
            <div className="flex flex-wrap justify-between gap-3"><div><b>{formatUsd(Number(p.amount).toFixed(2))}</b> entitlement ({p.kind}) · {(Array.isArray(p.publisher_profiles) ? p.publisher_profiles[0] : p.publisher_profiles)?.display_name ?? "publisher"} · <Link className="underline" href={`/admin/orders/${p.order_id}`}>order</Link><div className="text-xs text-inksoft">Target to start processing: {fmtDateTime(p.process_by)}{isOverdue(p, new Date()) ? <b className="text-redsig"> · OVERDUE</b> : ""}</div></div><div className="text-right"><span className="status-pill">{p.status}</span>{p.attempts ? <div className="text-xs text-inksoft">attempt {p.attempts}</div> : null}</div></div>
            {p.hold_reason && <div className="text-redsig mt-2">Hold: {p.hold_reason}</div>}
            {p.last_error && <div className="text-inksoft mt-1">Note: {p.last_error}</div>}
            {d && <div className="mt-2">Destination: {d.bank_name} •••• {d.account_last4} ({d.currency}) · {d.account_holder} · <Link className="underline" href={`/admin/payouts?reveal=${p.destination_id}`}>show full details (audited)</Link></div>}
            {reveal && sp.reveal === p.destination_id && <div className="mt-2 rounded border border-line bg-paperdim p-3 font-mono break-all">{reveal.holder} · {reveal.bank} · {reveal.account}{reveal.swift ? ` · ${reveal.swift}` : ""} · {reveal.currency}</div>}

            {(p.status === "PROCESSING" || p.status === "UNCERTAIN") && (
              <form action={recordPayout} className="grid gap-2 mt-4 border-t border-line pt-4 max-w-2xl">
                <input type="hidden" name="payout_id" value={p.id} />
                <p className="text-xs text-inksoft">{p.status === "UNCERTAIN" ? "This transfer is UNCERTAIN. Check the bank statement, then record what really happened. Do not send it again before reconciling." : "Make the transfer in your bank first, then record it here."}</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  <div><label className="label" htmlFor={`o${p.id}`}>Outcome</label><select id={`o${p.id}`} name="outcome" className="input"><option value="paid">Transfer sent and confirmed</option><option value="failed">Transfer failed / not sent</option>{p.status === "PROCESSING" && <option value="uncertain">Unsure: needs reconciliation</option>}</select></div>
                  <div><label className="label" htmlFor={`c${p.id}`}>Currency sent</label><select id={`c${p.id}`} name="payout_currency" defaultValue={d?.currency ?? "USD"} className="input"><option>USD</option><option>PKR</option></select></div>
                  <div><label className="label" htmlFor={`a${p.id}`}>Amount sent</label><input id={`a${p.id}`} name="payout_amount" className="input" inputMode="decimal" placeholder={d?.currency === "USD" ? Number(p.amount).toFixed(2) : "e.g. 27300"} /></div>
                  <div><label className="label" htmlFor={`r${p.id}`}>Bank transfer reference</label><input id={`r${p.id}`} name="reference" maxLength={120} className="input" /></div>
                  <div><label className="label" htmlFor={`f${p.id}`}>PKR per USD used (PKR only)</label><input id={`f${p.id}`} name="fx_rate" className="input" inputMode="decimal" /></div>
                  <div><label className="label" htmlFor={`k${p.id}`}>Disclosed conversion cost</label><input id={`k${p.id}`} name="conversion_cost" className="input" inputMode="decimal" placeholder="0" /></div>
                </div>
                <div><label className="label" htmlFor={`e${p.id}`}>Evidence (e.g. statement line, receipt id)</label><textarea id={`e${p.id}`} name="evidence" rows={2} maxLength={1000} className="input" /></div>
                <div><label className="label" htmlFor={`n${p.id}`}>Note (for failed / uncertain)</label><input id={`n${p.id}`} name="error_note" maxLength={400} className="input" /></div>
                <button className="btn-primary w-fit">Record result</button>
              </form>)}
            {p.status === "FAILED" && <form action={retryPayout} className="mt-3"><input type="hidden" name="payout_id" value={p.id} /><button className="btn">Re-queue for another attempt</button></form>}
            <div className="flex flex-wrap gap-3 mt-3 border-t border-line pt-3">
              {p.status === "HELD" ? <form action={holdOrReleasePayouts}><input type="hidden" name="order_id" value={p.order_id} /><input type="hidden" name="op" value="release" /><button className="btn">Release hold</button></form>
                : ["ELIGIBLE", "FAILED"].includes(p.status) ? <form action={holdOrReleasePayouts} className="flex gap-2"><input type="hidden" name="order_id" value={p.order_id} /><input type="hidden" name="op" value="hold" /><input name="reason" required minLength={5} maxLength={300} placeholder="Reason for hold" className="input w-56" /><button className="btn">Hold</button></form> : null}
              {["ELIGIBLE", "HELD", "FAILED"].includes(p.status) && <form action={cancelPayoutEntitlement} className="flex gap-2"><input type="hidden" name="order_id" value={p.order_id} /><label className="sr-only" htmlFor={`cx${p.id}`}>Reason for rejecting this payout</label><input id={`cx${p.id}`} name="reason" required minLength={10} maxLength={300} placeholder="Reason to reject (min 10 chars)" className="input w-64" /><button className="btn-danger">Reject payout</button></form>}
            </div>
          </li>); })}</ul>)}

      <h2 className="font-serif font-semibold text-xl mb-3">Payout history (last 25 paid)</h2>
      <ul className="text-sm grid gap-1">{(recent ?? []).map((p: any) => <li key={p.id}>{fmtDateTime(p.confirmed_at)} · {(Array.isArray(p.publisher_profiles) ? p.publisher_profiles[0] : p.publisher_profiles)?.display_name ?? "publisher"} · {formatUsd(Number(p.amount).toFixed(2))} entitlement · sent {p.payout_amount} {p.payout_currency} · ref {p.provider_reference ?? "n/a"}</li>)}</ul>
    </div>
  );
}
