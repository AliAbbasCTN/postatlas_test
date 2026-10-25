import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toggleSavedPublisher } from "@/lib/actions/saved-publishers";
import { PageHeader, EmptyState, Money } from "@/components/ui";

export const metadata = { title: "Find Publishers" };

export default async function DashboardPublishers() {
  await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("saved_publishers").select("website_id, publisher_websites(id, domain, niche, price_guest_post, price_link_insertion, status)").limit(100);
  const rows: any[] = (data ?? []).map((r: any) => (Array.isArray(r.publisher_websites) ? r.publisher_websites[0] : r.publisher_websites)).filter((w: any) => w && w.status === "approved");
  return (
    <div>
      <PageHeader title="Find Publishers" subtitle="Search the marketplace for websites to publish on, and come back to the publishers you saved." action={<Link className="btn-primary" href="/publishers">Explore Sites</Link>} />
      {rows.length === 0 ? <EmptyState title="No saved publishers yet" action={{ href: "/publishers", label: "Explore Sites" }}>Save publishers you like and they will show up here.</EmptyState> : (
        <ul className="grid gap-3">
          {rows.map((w) => (
            <li key={w.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div><Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="break-all font-semibold hover:underline">{w.domain}</Link><div className="text-xs text-inksoft">{w.niche ?? "-"}</div></div>
              <div className="flex flex-wrap items-center gap-3"><div className="text-sm text-inksoft">{w.price_guest_post != null && <div>Guest post <Money value={w.price_guest_post} /></div>}{w.price_link_insertion != null && <div>Link insertion <Money value={w.price_link_insertion} /></div>}</div>
                <Link className="btn-primary" href={`/dashboard/orders/new?publisher=${w.id}`}>Order</Link>
                <form action={toggleSavedPublisher}><input type="hidden" name="website_id" value={w.id} /><input type="hidden" name="currently_saved" value="true" /><button className="btn">Remove</button></form></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
