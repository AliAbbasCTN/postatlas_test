import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toggleSavedPublisher } from "@/lib/actions/saved-publishers";
import { PageHeader, EmptyState, Money } from "@/components/ui";

export const metadata = { title: "Publishers" };

export default async function DashboardPublishers() {
  await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("saved_publishers").select("website_id, publisher_websites(id, domain, niche, price_guest_post, price_link_insertion, status)").limit(100);
  const rows: any[] = (data ?? []).map((r: any) => (Array.isArray(r.publisher_websites) ? r.publisher_websites[0] : r.publisher_websites)).filter((w: any) => w && w.status === "approved");
  return (
    <div>
      <PageHeader title="Publishers" subtitle="Publishers you saved. Browse the marketplace to find more." action={<Link className="btn-primary" href="/publishers">Browse marketplace</Link>} />
      {rows.length === 0 ? <EmptyState title="No saved publishers yet" action={{ href: "/publishers", label: "Browse marketplace" }}>Save publishers you like and they will show up here.</EmptyState> : (
        <ul className="grid gap-3">
          {rows.map((w) => (
            <li key={w.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div><Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="font-serif font-semibold">{w.domain}</Link><div className="text-xs text-inksoft">{w.niche ?? "-"}</div></div>
              <div className="flex items-center gap-3"><Money value={w.price_guest_post ?? w.price_link_insertion} />
                <Link className="btn-primary" href={`/dashboard/orders/new?publisher=${w.id}`}>Order</Link>
                <form action={toggleSavedPublisher}><input type="hidden" name="website_id" value={w.id} /><input type="hidden" name="currently_saved" value="true" /><button className="btn">Remove</button></form></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
