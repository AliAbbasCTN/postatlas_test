import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { reassignOrder, resolveRecovery } from "@/lib/actions/finance-admin";
import { findReplacementCandidates } from "@/lib/services/recovery";
import { formatUsd } from "@/lib/money";
import Link from "next/link";

export const metadata = { title: "Recovery cases" };
const LABEL: Record<string, string> = { publisher_rejection: "Publisher declined a paid order", link_restoration: "Verified link disappeared" };

export default async function AdminRecovery({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const db = createAdminClient();
  const { data } = await db.from("recovery_cases").select("id, order_id, kind, status, reason, deadline_at, escalated_at, created_at, resolution, orders(customer_price, order_type, status)").in("status", ["OPEN", "ESCALATED", "REASSIGNED"]).order("deadline_at").limit(50);
  const cases: any[] = data ?? [];
  const withCandidates = await Promise.all(cases.map(async (c) => ({ c, cands: c.status === "REASSIGNED" ? [] : await findReplacementCandidates(c.order_id) })));
  return (
    <div>
      <PageHeader title="Recovery cases" subtitle="Paid orders a publisher declined, and verified links that disappeared. The customer is never charged again and the original publisher is never paid more." />
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />
      {cases.length === 0 ? <EmptyState title="No open recovery cases" /> : (
        <ul className="grid gap-4">{withCandidates.map(({ c, cands }) => { const o = Array.isArray(c.orders) ? c.orders[0] : c.orders; return (
          <li key={c.id} className="card text-sm">
            <div className="flex flex-wrap justify-between gap-3"><div><b>{LABEL[c.kind]}</b> · <Link className="underline" href={`/admin/orders/${c.order_id}`}>order</Link> · customer paid {formatUsd(Number(o?.customer_price ?? 0).toFixed(2))} list price<div className="text-xs text-inksoft">Opened {fmtDateTime(c.created_at)} · deadline {fmtDateTime(c.deadline_at)}{c.escalated_at ? ` · escalated ${fmtDateTime(c.escalated_at)}` : ""}</div></div><span className="status-pill">{c.status}</span></div>
            <p className="mt-2 text-inksoft">{c.reason}</p>
            {c.status === "REASSIGNED" && <p className="mt-2">Waiting for the replacement publisher to accept and for the link to verify. The replacement&apos;s own payout is created only after that check passes.</p>}
            {c.status !== "REASSIGNED" && (<>
              <form action={reassignOrder} className="grid gap-2 mt-4 border-t border-line pt-4 max-w-xl">
                <input type="hidden" name="case_id" value={c.id} />
                <label className="label" htmlFor={`l${c.id}`}>Give the order to another approved publisher (same customer price and terms)</label>
                <select id={`l${c.id}`} name="listing_id" required className="input"><option value="">Choose a publisher...</option>{cands.map((x) => <option key={x.id} value={x.id}>{x.domain} · {formatUsd(x.price.toFixed(2))}{x.sameNiche ? " · same niche" : ""}{Number(o?.customer_price) < x.price ? " · costs PostAtlas more than the customer paid" : ""}</option>)}</select>
                <input name="note" maxLength={500} placeholder="Note (optional)" className="input" />
                <button className="btn-primary w-fit" disabled={cands.length === 0}>Reassign</button>
                {cands.length === 0 && <p className="text-xs text-redsig">No eligible alternative publisher was found. Resolve with a refund or another remedy below.</p>}
                <p className="text-xs text-inksoft">The customer&apos;s price never changes. If the replacement costs more, PostAtlas bears the difference and it is recorded in the ledger.</p>
              </form>
              <form action={resolveRecovery} className="grid gap-2 mt-4 border-t border-line pt-4 max-w-xl">
                <input type="hidden" name="case_id" value={c.id} />
                <div className="grid sm:grid-cols-2 gap-2"><div><label className="label" htmlFor={`x${c.id}`}>Close without a replacement</label><select id={`x${c.id}`} name="outcome" className="input"><option value="refund">Refund the customer (opens a refund request)</option><option value="other">Other agreed remedy</option><option value="cancel">Cancel the case</option></select></div>
                  <div><label className="label" htmlFor={`y${c.id}`}>Resolution note</label><input id={`y${c.id}`} name="resolution" required minLength={5} maxLength={500} className="input" /></div></div>
                <button className="btn w-fit">Close case</button>
              </form></>)}
          </li>); })}</ul>)}
    </div>
  );
}
