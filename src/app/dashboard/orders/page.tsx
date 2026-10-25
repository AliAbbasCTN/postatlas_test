import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Money, Pagination, parsePage, fmtDate, FilterTabs } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { customerNextAction } from "@/lib/order-state";
import { CUSTOMER_GROUPS, parseGroup, statusesOf } from "@/lib/order-groups";
import { deadlineState, closedOrderLabel, formatDueUtc } from "@/lib/order-deadline";

export const metadata = { title: "Orders" };
const PAGE = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const sp = await searchParams;
  const { org } = await requireWorkspace();
  const page = parsePage(sp.page);
  const group = parseGroup(sp.status, CUSTOMER_GROUPS);
  const supabase = await createServerSupabaseClient();
  const base = () => supabase.from("orders").select("id, status, customer_price, created_at, order_type, target_url, due_at, expiry_choice, publisher_websites(domain)", { count: "exact" }).eq("organization_id", org.id);
  const counts = (key: string) => supabase.from("orders").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", statusesOf(key as never, CUSTOMER_GROUPS));
  const overdueCount = () => supabase.from("orders").select("id", { count: "exact", head: true }).eq("organization_id", org.id).in("status", ["ACCEPTED", "IN_PROGRESS", "REPLACEMENT_REQUESTED"]).lt("due_at", new Date().toISOString());
  const [{ data, count }, all, overdue, ...perGroup] = await Promise.all([
    base().in("status", statusesOf(group, CUSTOMER_GROUPS)).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
    overdueCount(),
    ...CUSTOMER_GROUPS.map((g) => counts(g.key))
  ]);
  const rows: any[] = data ?? [];
  const tabs = [{ key: "", label: "All", count: all.count ?? 0 }, ...CUSTOMER_GROUPS.map((g, i) => ({ key: g.key, label: g.label, count: perGroup[i]?.count ?? 0 }))];
  const needsAction = tabs.find((t) => t.key === "action")?.count ?? 0;
  const lateCount = overdue.count ?? 0;
  const pathOf = (u: string) => { try { return new URL(u).pathname || "/"; } catch { return u; } };
  return (
    <div>
      <PageHeader title="Manage Orders" subtitle="Every placement you have ordered, and what happens next." />
      {(all.count ?? 0) === 0 ? <EmptyState title="No orders yet" action={{ href: "/dashboard/opportunities", label: "View opportunities" }}>Choose a page and a publisher to place your first order.</EmptyState> : (
        <>
          {lateCount > 0 && <p className="mb-4 rounded-md border border-redsig/40 bg-[#FBE4E1] px-4 py-3 text-sm text-redsig"><strong>{lateCount} order{lateCount === 1 ? " is" : "s are"} past the delivery deadline.</strong> Open {lateCount === 1 ? "it" : "them"} to ask for a refund or an alternative placement. <Link href="/dashboard/orders?status=progress" className="underline">Show in-progress orders</Link></p>}
          {needsAction > 0 && group !== "action" && <p className="mb-4 rounded-md border border-accent/50 bg-accentsoft px-4 py-3 text-sm"><strong>{needsAction} order{needsAction === 1 ? " needs" : "s need"} your action.</strong> <Link href="/dashboard/orders?status=action" className="underline">Show them</Link></p>}
          <FilterTabs basePath="/dashboard/orders" tabs={tabs} active={group} />
          {rows.length === 0 ? <EmptyState title="Nothing here">No orders in this group. <Link href="/dashboard/orders" className="text-accenttext underline">Show all orders</Link></EmptyState> : (
            <>
              <div className="table-wrap hidden md:block"><table className="w-full text-sm">
                <thead><tr className="border-b border-line bg-paperdim text-left text-xs text-inksoft"><th scope="col" className="p-3 font-medium">Publisher</th><th scope="col" className="p-3 font-medium">Page</th><th scope="col" className="p-3 font-medium">Price</th><th scope="col" className="p-3 font-medium">Status</th><th scope="col" className="p-3"><span className="sr-only">Next step</span></th></tr></thead>
                <tbody>{rows.map((o) => {
                  const site = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites;
                  const na = customerNextAction(o.status);
                  const urgent = CUSTOMER_GROUPS[0].statuses.includes(o.status);
                  return (
                    <tr key={o.id} className="border-b border-line align-top last:border-0">
                      <td className="p-3"><div className="font-medium">{site?.domain}</div><div className="text-xs text-inksoft">{fmtDate(o.created_at)}</div></td>
                      <td className="max-w-[240px] break-all p-3">{pathOf(o.target_url)}</td>
                      <td className="p-3"><Money value={o.customer_price} /></td>
                      <td className="p-3"><StatusBadge status={o.status} label={closedOrderLabel(o.status, o.expiry_choice) ?? undefined} />{deadlineState(o).kind === "overdue" ? <div className="mt-1 max-w-[220px] text-xs font-medium text-redsig">Deadline missed: choose a refund or an alternative</div> : deadlineState(o).kind === "running" ? <div className="mt-1 max-w-[220px] text-xs text-inksoft">Due {formatDueUtc(o.due_at)}</div> : na?.hint && <div className="mt-1 max-w-[220px] text-xs text-inksoft">{na.hint}</div>}</td>
                      <td className="p-3 text-right"><Link className={urgent ? "btn-primary" : "btn"} href={`/dashboard/orders/${o.id}`}>{na?.label ?? "View"}</Link></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <ul className="grid gap-3 md:hidden">{rows.map((o) => {
                const site = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites;
                const na = customerNextAction(o.status);
                const urgent = CUSTOMER_GROUPS[0].statuses.includes(o.status);
                return (
                  <li key={o.id} className="card !p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-all font-medium">{site?.domain}</div><div className="text-xs text-inksoft">{fmtDate(o.created_at)} · <Money value={o.customer_price} /></div></div><StatusBadge status={o.status} label={closedOrderLabel(o.status, o.expiry_choice) ?? undefined} /></div>
                    <div className="mt-2 break-all text-xs text-inksoft">{pathOf(o.target_url)}</div>
                    {deadlineState(o).kind === "overdue" ? <p className="mt-2 text-sm font-medium text-redsig">Deadline missed: choose a refund or an alternative.</p> : deadlineState(o).kind === "running" ? <p className="mt-2 text-sm text-inksoft">Due {formatDueUtc(o.due_at)}</p> : na?.hint && <p className="mt-2 text-sm text-inksoft">{na.hint}</p>}
                    <Link className={`${urgent ? "btn-primary" : "btn"} mt-3 w-full`} href={`/dashboard/orders/${o.id}`}>{na?.label ?? "View"}</Link>
                  </li>
                );
              })}</ul>
              <Pagination basePath="/dashboard/orders" page={page} pageSize={PAGE} total={count ?? 0} params={{ status: group || undefined }} />
            </>
          )}
        </>
      )}
    </div>
  );
}
