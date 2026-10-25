import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, Pagination, parsePage, fmtDateTime } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Disputes" };
const PAGE = 25;

export default async function AdminDisputes({ searchParams }: { searchParams: Promise<{ page?: string; all?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const page = parsePage(sp.page);
  let q = createAdminClient().from("disputes").select("id, order_id, category, status, created_at, orders(organizations(name), publisher_websites(domain))", { count: "exact" }).order("created_at", { ascending: false });
  if (sp.all !== "1") q = q.in("status", ["OPEN", "UNDER_REVIEW"]);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Disputes" action={<Link className="btn" href={sp.all === "1" ? "/admin/disputes" : "/admin/disputes?all=1"}>{sp.all === "1" ? "Open only" : "Show closed too"}</Link>} />
      {rows.length === 0 ? <EmptyState title="No disputes" /> : (
        <ul className="grid gap-3">{rows.map((d) => { const o = Array.isArray(d.orders) ? d.orders[0] : d.orders; const org = Array.isArray(o?.organizations) ? o.organizations[0] : o?.organizations; const s = Array.isArray(o?.publisher_websites) ? o.publisher_websites[0] : o?.publisher_websites; return (
          <li key={d.id} className="card flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">{org?.name} / {s?.domain}</div><div className="text-xs text-inksoft">{d.category} · {fmtDateTime(d.created_at)}</div></div><div className="flex items-center gap-3"><StatusBadge status={d.status} /><Link className="btn" href={`/admin/orders/${d.order_id}`}>Open</Link></div></li>); })}</ul>)}
      <Pagination basePath="/admin/disputes" page={page} pageSize={PAGE} total={count ?? 0} params={{ all: sp.all }} />
    </div>
  );
}
