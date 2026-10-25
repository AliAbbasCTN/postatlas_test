import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, Money, Pagination, parsePage, fmtDate } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { ORDER_STATUS_LABEL } from "@/lib/order-state";

export const metadata = { title: "Orders" };
const PAGE = 25;

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const page = parsePage(sp.page);
  const status = sp.status && sp.status in ORDER_STATUS_LABEL ? sp.status : undefined;
  let q = createAdminClient().from("orders").select("id, status, customer_price, created_at, order_type, organizations(name), publisher_websites(domain)", { count: "exact" }).order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Orders" />
      <form method="get" className="flex gap-3 items-end mb-5"><div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={status ?? ""} className="input"><option value="">All</option>{Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div><button className="btn">Filter</button></form>
      {rows.length === 0 ? <EmptyState title="No orders match" /> : (
        <div className="table-wrap"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">Customer</th><th className="p-3">Publisher</th><th className="p-3">Price</th><th className="p-3">Created</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
          <tbody>{rows.map((o) => { const org = Array.isArray(o.organizations) ? o.organizations[0] : o.organizations; const s = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites; return (
            <tr key={o.id} className="border-b border-line last:border-0"><td className="p-3">{org?.name}</td><td className="p-3">{s?.domain}</td><td className="p-3"><Money value={o.customer_price} /></td><td className="p-3">{fmtDate(o.created_at)}</td><td className="p-3"><StatusBadge status={o.status} /></td><td className="p-3 text-right"><Link className="btn" href={`/admin/orders/${o.id}`}>Open</Link></td></tr>); })}</tbody></table></div>)}
      <Pagination basePath="/admin/orders" page={page} pageSize={PAGE} total={count ?? 0} params={{ status }} />
    </div>
  );
}
