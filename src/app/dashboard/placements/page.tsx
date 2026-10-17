import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Pagination, parsePage, fmtDateTime } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Placements" };
const PAGE = 20;

export default async function PlacementsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  await requireWorkspace();
  const page = parsePage(sp.page);
  const supabase = await createServerSupabaseClient();
  const { data, count } = await supabase.from("published_placements")
    .select("id, published_url, health, last_checked_at, verified_at, order_id, orders(status, target_url, publisher_websites(domain))", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Placements" subtitle="Links that have been published for you." />
      {rows.length === 0 ? <EmptyState title="Nothing published yet" action={{ href: "/dashboard/orders", label: "View orders" }}>Once a publisher publishes your article it will show up here.</EmptyState> : (
        <>
          <ul className="grid gap-3">{rows.map((p) => {
            const o = Array.isArray(p.orders) ? p.orders[0] : p.orders;
            const site = Array.isArray(o?.publisher_websites) ? o?.publisher_websites[0] : o?.publisher_websites;
            return (
              <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><div className="font-medium">{site?.domain}</div><a className="text-xs text-accenttext underline break-all" href={p.published_url} target="_blank" rel="noopener noreferrer nofollow">{p.published_url}</a>
                  <div className="text-xs text-inksoft mt-1">Last checked {fmtDateTime(p.last_checked_at)}</div></div>
                <div className="flex items-center gap-3"><StatusBadge status={p.health} /><Link className="btn" href={`/dashboard/orders/${p.order_id}`}>Details</Link></div>
              </li>
            );
          })}</ul>
          <Pagination basePath="/dashboard/placements" page={page} pageSize={PAGE} total={count ?? 0} />
        </>
      )}
    </div>
  );
}
