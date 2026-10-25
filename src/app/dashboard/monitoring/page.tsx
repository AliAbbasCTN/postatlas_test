import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Pagination, parsePage, fmtDateTime } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Monitoring" };
const PAGE = 25;

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  await requireWorkspace();
  const page = parsePage(sp.page);
  const supabase = await createServerSupabaseClient();
  const [{ count: healthy }, { count: issues }, { data, count }] = await Promise.all([
    supabase.from("published_placements").select("id", { count: "exact", head: true }).eq("health", "HEALTHY"),
    supabase.from("published_placements").select("id", { count: "exact", head: true }).eq("health", "ISSUE"),
    supabase.from("backlink_checks").select("id, checked_at, result, message, trigger, published_placements(order_id, published_url)", { count: "exact" }).order("checked_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1)
  ]);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Monitoring" subtitle="We re-check every verified placement about once a day and tell you if something changes." />
      <div className="grid grid-cols-2 gap-4 mb-8 max-w-md">
        <div className="card"><div className="text-xs text-inksoft">Healthy</div><div className="font-mono text-2xl">{healthy ?? 0}</div></div>
        <div className="card"><div className="text-xs text-inksoft">Need attention</div><div className="font-mono text-2xl">{issues ?? 0}</div></div>
      </div>
      {rows.length === 0 ? <EmptyState title="No checks yet">Checks start as soon as a placement is published.</EmptyState> : (
        <>
          <div className="table-wrap"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">When</th><th className="p-3">Result</th><th className="p-3">Details</th><th className="p-3"></th></tr></thead>
            <tbody>{rows.map((c) => { const p = Array.isArray(c.published_placements) ? c.published_placements[0] : c.published_placements; return (
              <tr key={c.id} className="border-b border-line last:border-0 align-top"><td className="p-3 whitespace-nowrap">{fmtDateTime(c.checked_at)}</td><td className="p-3"><StatusBadge status={c.result} /></td>
                <td className="p-3">{c.message}<div className="text-xs text-inksoft break-all">{p?.published_url}</div></td>
                <td className="p-3 text-right">{p?.order_id && <Link className="btn" href={`/dashboard/orders/${p.order_id}`}>Order</Link>}</td></tr>); })}</tbody></table></div>
          <Pagination basePath="/dashboard/monitoring" page={page} pageSize={PAGE} total={count ?? 0} />
        </>
      )}
    </div>
  );
}
