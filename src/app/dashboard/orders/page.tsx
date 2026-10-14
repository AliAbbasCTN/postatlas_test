import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Money, Pagination, parsePage, fmtDate } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { customerNextAction } from "@/lib/order-state";

export const metadata = { title: "Orders" };
const PAGE = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const { org } = await requireWorkspace();
  const page = parsePage(sp.page);
  const supabase = await createServerSupabaseClient();
  const { data, count } = await supabase.from("orders").select("id, status, customer_price, created_at, order_type, target_url, publisher_websites(domain)", { count: "exact" })
    .eq("organization_id", org.id).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Orders" subtitle="Every placement you have ordered, and what happens next." />
      {rows.length === 0 ? <EmptyState title="No orders yet" action={{ href: "/dashboard/opportunities", label: "View opportunities" }}>Choose a page and a publisher to place your first order.</EmptyState> : (
        <>
          <div className="table-wrap"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">Publisher</th><th className="p-3">Page</th><th className="p-3">Price</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead>
            <tbody>{rows.map((o) => {
              const site = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites;
              const na = customerNextAction(o.status);
              return (
                <tr key={o.id} className="border-b border-line last:border-0 align-top">
                  <td className="p-3"><div className="font-medium">{site?.domain}</div><div className="text-xs text-inksoft">{fmtDate(o.created_at)}</div></td>
                  <td className="p-3 break-all max-w-[240px]">{new URL(o.target_url).pathname || "/"}</td>
                  <td className="p-3"><Money value={o.customer_price} /></td>
                  <td className="p-3"><StatusBadge status={o.status} /></td>
                  <td className="p-3 text-right"><Link className="btn" href={`/dashboard/orders/${o.id}`}>{na?.label ?? "View"}</Link></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <Pagination basePath="/dashboard/orders" page={page} pageSize={PAGE} total={count ?? 0} />
        </>
      )}
    </div>
  );
}
