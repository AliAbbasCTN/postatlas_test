import Link from "next/link";
import { requirePublisher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, Pagination, parsePage, fmtDate, FilterTabs } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { deadlineState, formatDueUtc } from "@/lib/order-deadline";
import { PUBLISHER_GROUPS, PUBLISHER_VISIBLE_STATUSES, parseGroup, statusesOf } from "@/lib/order-groups";

export const metadata = { title: "Orders" };
const PAGE = 20;

export default async function PublisherOrders({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const sp = await searchParams;
  const { user } = await requirePublisher();
  const page = parsePage(sp.page);
  const group = parseGroup(sp.status, PUBLISHER_GROUPS);
  const db = createAdminClient();
  const { data: profile } = await db.from("publisher_profiles").select("id").eq("user_id", user.id).maybeSingle();
  const { data: listings } = profile ? await db.from("publisher_websites").select("id").eq("publisher_id", profile.id) : { data: [] as any[] };
  const ids = (listings ?? []).map((l: any) => l.id);
  // Publishers only ever see orders for THEIR listings, and only once the order has reached them (after payment approval
  // and article submission) - never unpaid or pre-review orders. A tab can only NARROW this set, never widen it.
  const visible = PUBLISHER_VISIBLE_STATUSES;
  const countOf = (key: string) => db.from("orders").select("id", { count: "exact", head: true }).in("website_id", ids).in("status", statusesOf(key as never, PUBLISHER_GROUPS, visible));
  const [{ data, count }, ...perGroup] = ids.length
    ? await Promise.all([
        db.from("orders").select("id, status, order_type, target_url, created_at, due_at, publisher_websites(domain)", { count: "exact" }).in("website_id", ids)
          .in("status", statusesOf(group, PUBLISHER_GROUPS, visible)).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
        ...PUBLISHER_GROUPS.map((g) => countOf(g.key))
      ])
    : [{ data: [] as any[], count: 0 }, ...PUBLISHER_GROUPS.map(() => ({ count: 0 }))];
  const rows: any[] = data ?? [];
  const counts = perGroup.map((r: any) => r?.count ?? 0);
  const total = counts.reduce((a: number, b: number) => a + b, 0);
  const tabs = [{ key: "", label: "All", count: total }, ...PUBLISHER_GROUPS.map((g, i) => ({ key: g.key, label: g.label, count: counts[i] }))];
  const waiting = counts[0] ?? 0;
  const typeLabel = (t: string) => (t === "guest_post" ? "Guest post" : "Link insertion");
  return (
    <div>
      <PageHeader title="Manage Orders" subtitle="Placements assigned to your websites." />
      {total === 0 ? <EmptyState title="No orders yet">Orders appear here after the customer&apos;s payment is approved and their article is ready.</EmptyState> : (
        <>
          {waiting > 0 && group !== "answer" && <p className="mb-4 rounded-md border border-accent/50 bg-accentsoft px-4 py-3 text-sm"><strong>{waiting} order{waiting === 1 ? " is" : "s are"} waiting for your answer.</strong> <Link href="/publisher/orders?status=answer" className="underline">Show them</Link></p>}
          <FilterTabs basePath="/publisher/orders" tabs={tabs} active={group} />
          {rows.length === 0 ? <EmptyState title="Nothing here">No orders in this group. <Link href="/publisher/orders" className="text-accenttext underline">Show all orders</Link></EmptyState> : (
            <>
              <div className="table-wrap hidden md:block"><table className="w-full text-sm"><thead><tr className="border-b border-line bg-paperdim text-left text-xs text-inksoft"><th scope="col" className="p-3 font-medium">Website</th><th scope="col" className="p-3 font-medium">Type</th><th scope="col" className="p-3 font-medium">Received</th><th scope="col" className="p-3 font-medium">Status</th><th scope="col" className="p-3"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>{rows.map((o) => { const s = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites; return (
                  <tr key={o.id} className="border-b border-line last:border-0"><td className="p-3 font-medium">{s?.domain}</td><td className="p-3">{typeLabel(o.order_type)}</td><td className="p-3">{fmtDate(o.created_at)}</td>
                    <td className="p-3"><StatusBadge status={o.status} />{deadlineState(o).kind === "overdue" ? <div className="mt-1 text-xs font-medium text-redsig">Past deadline ({formatDueUtc(o.due_at)})</div> : deadlineState(o).kind === "running" ? <div className="mt-1 text-xs text-inksoft">Deliver by {formatDueUtc(o.due_at)}</div> : null}</td><td className="p-3 text-right"><Link className={o.status === "PENDING_PUBLISHER" ? "btn-primary" : "btn"} href={`/publisher/orders/${o.id}`}>{o.status === "PENDING_PUBLISHER" ? "Review" : "Open"}</Link></td></tr>); })}</tbody></table></div>
              <ul className="grid gap-3 md:hidden">{rows.map((o) => { const s = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites; return (
                <li key={o.id} className="card !p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-all font-medium">{s?.domain}</div><div className="text-xs text-inksoft">{typeLabel(o.order_type)} · {fmtDate(o.created_at)}</div></div><StatusBadge status={o.status} /></div>
                  {deadlineState(o).kind === "overdue" ? <p className="mt-2 text-xs font-medium text-redsig">Past deadline ({formatDueUtc(o.due_at)})</p> : deadlineState(o).kind === "running" ? <p className="mt-2 text-xs text-inksoft">Deliver by {formatDueUtc(o.due_at)}</p> : null}
                  <Link className={`${o.status === "PENDING_PUBLISHER" ? "btn-primary" : "btn"} mt-3 w-full`} href={`/publisher/orders/${o.id}`}>{o.status === "PENDING_PUBLISHER" ? "Review" : "Open"}</Link>
                </li>); })}</ul>
              <Pagination basePath="/publisher/orders" page={page} pageSize={PAGE} total={count ?? 0} params={{ status: group || undefined }} />
            </>
          )}
        </>
      )}
    </div>
  );
}
