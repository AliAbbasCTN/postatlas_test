import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { advanceRefund, recordRefund, requestRefundAction } from "@/lib/actions/finance-admin";
import { formatAmount } from "@/lib/money";
import Link from "next/link";

export const metadata = { title: "Refunds" };

export default async function AdminRefunds({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const { data } = await createAdminClient().from("refunds").select("id, order_id, amount, currency, status, reason, requested_role, created_at, transfer_reference, failure_reason").order("created_at", { ascending: false }).limit(60);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Refunds" subtitle="No automatic refund provider is connected. Approve, make the transfer in your bank, then record the real reference. An order is cancelled only after a completed full refund." />
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />
      <form action={requestRefundAction} className="card mb-6 grid gap-2 max-w-xl">
        <h2 className="font-serif font-semibold">Open a refund request</h2>
        <div className="grid sm:grid-cols-2 gap-2"><div><label className="label" htmlFor="oid">Order id</label><input id="oid" name="order_id" required className="input" /></div><div><label className="label" htmlFor="amt">Amount (blank = full amount paid)</label><input id="amt" name="amount" className="input" inputMode="decimal" /></div></div>
        <div><label className="label" htmlFor="why">Reason</label><input id="why" name="reason" required minLength={5} maxLength={900} className="input" /></div>
        <button className="btn w-fit">Request refund</button>
        <p className="text-xs text-inksoft">This only records a request. It cannot exceed the amount paid, including refunds already requested or sent.</p>
      </form>
      {rows.length === 0 ? <EmptyState title="No refunds" /> : (
        <ul className="grid gap-4">{rows.map((r) => (
          <li key={r.id} className="card text-sm">
            <div className="flex flex-wrap justify-between gap-3"><div><b>{formatAmount(r.amount, r.currency)}</b> · <Link className="underline" href={`/admin/orders/${r.order_id}`}>order</Link><div className="text-xs text-inksoft">{fmtDateTime(r.created_at)} · requested by {r.requested_role}</div></div><span className="status-pill">{r.status}</span></div>
            <p className="mt-2">{r.reason}</p>
            {r.failure_reason && <p className="text-redsig mt-1">{r.failure_reason}</p>}
            {r.transfer_reference && <p className="text-inksoft mt-1">Transfer reference recorded.</p>}
            <div className="flex flex-wrap gap-3 mt-3">
              {r.status === "REQUESTED" && <form action={advanceRefund}><input type="hidden" name="refund_id" value={r.id} /><input type="hidden" name="action" value="approve" /><button className="btn-primary">Approve</button></form>}
              {["REQUESTED", "APPROVED"].includes(r.status) && <form action={advanceRefund} className="flex gap-2"><input type="hidden" name="refund_id" value={r.id} /><input type="hidden" name="action" value="reject" /><input name="note" required minLength={5} maxLength={500} placeholder="Reason" className="input w-56" /><button className="btn-danger">Reject</button></form>}
              {r.status === "APPROVED" && <form action={advanceRefund}><input type="hidden" name="refund_id" value={r.id} /><input type="hidden" name="action" value="start" /><button className="btn">Start transfer</button></form>}
              {r.status === "FAILED" && <form action={advanceRefund}><input type="hidden" name="refund_id" value={r.id} /><input type="hidden" name="action" value="retry" /><button className="btn">Retry</button></form>}
            </div>
            {["PROCESSING", "UNCERTAIN"].includes(r.status) && (
              <form action={recordRefund} className="grid gap-2 mt-4 border-t border-line pt-4 max-w-xl">
                <input type="hidden" name="refund_id" value={r.id} />
                {r.status === "UNCERTAIN" && <p className="text-xs text-inksoft">UNCERTAIN: check the bank statement before recording. Do not send it again before reconciling.</p>}
                <div className="grid sm:grid-cols-2 gap-2"><div><label className="label" htmlFor={`o${r.id}`}>Outcome</label><select id={`o${r.id}`} name="outcome" className="input"><option value="completed">Refund sent and confirmed</option><option value="failed">Failed / not sent</option>{r.status === "PROCESSING" && <option value="uncertain">Unsure: needs reconciliation</option>}</select></div>
                  <div><label className="label" htmlFor={`r${r.id}`}>Transfer reference</label><input id={`r${r.id}`} name="reference" maxLength={120} className="input" /></div></div>
                <div><label className="label" htmlFor={`e${r.id}`}>Evidence</label><textarea id={`e${r.id}`} name="evidence" rows={2} maxLength={1000} className="input" /></div>
                <div><label className="label" htmlFor={`n${r.id}`}>Note (failed / uncertain)</label><input id={`n${r.id}`} name="error_note" maxLength={400} className="input" /></div>
                <button className="btn-primary w-fit">Record result</button>
              </form>)}
          </li>))}</ul>)}
    </div>
  );
}
