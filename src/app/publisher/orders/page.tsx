import Link from "next/link";
import { requirePublisher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, Pagination, parsePage, fmtDate } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Orders" };
const PAGE = 20;

export default async function PublisherOrders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const { user } = await requirePublisher();
  const page = parsePage(sp.page);
  const db = createAdminClient();
  const { data: profile } = await db.from("publisher_profiles").select("id").eq("user_id", user.id).maybeSingle();
  const { data: listings } = profile ? await db.from("publisher_websites").select("id").eq("publisher_id", profile.id) : { data: [] as any[] };
  const ids = (listings ?? []).map((l: any) => l.id);
  // Publishers only ever see orders for THEIR listings, and only once the order has reached them
  // (after payment approval and article submission) - never unpaid or pre-review orders.
  const { data, count } = ids.length
    ? await db.from("orders").select("id, status, order_type, target_url, created_at, publisher_websites(domain)", { count: "exact" }).in("website_id", ids)
        .in("status", ["PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED", "MONITORING", "ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "COMPLETED", "PUBLISHER_REJECTED", "DISPUTED"])
        .order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1)
    : { data: [] as any[], count: 0 };
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Orders" subtitle="Placements assigned to your websites." />
      {rows.length === 0 ? <EmptyState title="No orders yet">Orders appear here after the customer's payment is approved and their article is ready.</EmptyState> : (
        <>
          <div className="table-wrap"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">Website</th><th className="p-3">Type</th><th className="p-3">Received</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
            <tbody>{rows.map((o) => { const s = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites; return (
              <tr key={o.id} className="border-b border-line last:border-0"><td className="p-3">{s?.domain}</td><td className="p-3">{o.order_type === "guest_post" ? "Guest post" : "Link insertion"}</td><td className="p-3">{fmtDate(o.created_at)}</td>
                <td className="p-3"><StatusBadge status={o.status} /></td><td className="p-3 text-right"><Link className="btn" href={`/publisher/orders/${o.id}`}>{o.status === "PENDING_PUBLISHER" ? "Review" : "Open"}</Link></td></tr>); })}</tbody></table></div>
          <Pagination basePath="/publisher/orders" page={page} pageSize={PAGE} total={count ?? 0} />
        </>
      )}
    </div>
  );
}
