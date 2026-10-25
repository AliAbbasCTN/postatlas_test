import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewPayment } from "@/lib/actions/payments";
import { formatAmount } from "@/lib/money";
import { PageHeader, EmptyState, Money, Pagination, parsePage, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import Link from "next/link";

export const metadata = { title: "Payments" };
const PAGE = 20;

export default async function AdminPayments({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; page?: string; show?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const page = parsePage(sp.page);
  const all = sp.show === "all";
  const db = createAdminClient();
  let q = db.from("payments").select("id, order_id, amount, currency, transaction_reference, note, status, submitted_at, rejection_reason, payment_methods(name), orders(organization_id, organizations(name), publisher_websites(domain))", { count: "exact" }).order("submitted_at", { ascending: false });
  if (!all) q = q.eq("status", "PAYMENT_UNDER_REVIEW");
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Payments" subtitle="Check the money has really arrived before approving." action={<Link className="btn" href={all ? "/admin/payments" : "/admin/payments?show=all"}>{all ? "Show only pending" : "Show all"}</Link>} />
      <FormFeedback error={sp.error} success={sp.done ? `Payment ${sp.done === "approve" ? "approved" : "rejected"}.` : undefined} />
      {rows.length === 0 ? <EmptyState title="Nothing to review" /> : (
        <ul className="grid gap-4">{rows.map((p) => { const o = Array.isArray(p.orders) ? p.orders[0] : p.orders; const org = Array.isArray(o?.organizations) ? o.organizations[0] : o?.organizations; const site = Array.isArray(o?.publisher_websites) ? o.publisher_websites[0] : o?.publisher_websites; const m = Array.isArray(p.payment_methods) ? p.payment_methods[0] : p.payment_methods; return (
          <li key={p.id} className="card">
            <div className="flex flex-wrap justify-between gap-3"><div><div className="font-medium">{org?.name} to {site?.domain}</div><div className="text-xs text-inksoft">Submitted {fmtDateTime(p.submitted_at)} · <Link className="underline" href={`/admin/orders/${p.order_id}`}>order</Link></div></div><div className="text-right"><span className="font-mono">{formatAmount(p.amount, p.currency)}</span><div><StatusBadge status={p.status} /></div></div></div>
            <div className="text-sm mt-3">Method: {m?.name ?? "not stated"} · Reference: <span className="font-mono break-all">{p.transaction_reference}</span></div>
            {p.note && <div className="text-sm text-inksoft mt-1">Note: {p.note}</div>}
            {p.rejection_reason && <div className="text-sm text-redsig mt-1">Rejected: {p.rejection_reason}</div>}
            {p.status === "PAYMENT_UNDER_REVIEW" && (
              <div className="flex flex-wrap gap-3 mt-4">
                <form action={reviewPayment}><input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="decision" value="approve" /><button className="btn-primary">Approve payment</button></form>
                <form action={reviewPayment} className="flex gap-2 flex-wrap"><input type="hidden" name="payment_id" value={p.id} /><input type="hidden" name="decision" value="reject" /><label className="sr-only" htmlFor={`r${p.id}`}>Rejection reason</label><input id={`r${p.id}`} name="reason" required minLength={3} maxLength={500} placeholder="Reason shown to the customer" className="input w-64" /><button className="btn-danger">Reject</button></form>
              </div>)}
          </li>); })}</ul>)}
      <Pagination basePath="/admin/payments" page={page} pageSize={PAGE} total={count ?? 0} params={{ show: sp.show }} />
    </div>
  );
}
