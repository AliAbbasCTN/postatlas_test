import { requirePublisher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextStep, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Publisher overview" };

export default async function PublisherHome() {
  const { user } = await requirePublisher();
  const db = createAdminClient();
  const { data: profile } = await db.from("publisher_profiles").select("id, display_name, approved").eq("user_id", user.id).maybeSingle();
  const { data: listings } = profile ? await db.from("publisher_websites").select("id, domain, status").eq("publisher_id", profile.id) : { data: [] as any[] };
  const ids = (listings ?? []).map((l: any) => l.id);
  const { data: orders } = ids.length ? await db.from("orders").select("id, status").in("website_id", ids).in("status", ["PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "VERIFICATION_PENDING", "DISPUTED"]) : { data: [] as any[] };
  const waiting = (orders ?? []).filter((o: any) => o.status === "PENDING_PUBLISHER");
  const active = (orders ?? []).length;
  return (
    <div>
      <PageHeader title="Overview" subtitle={profile?.display_name} />
      {waiting.length > 0 ? <NextStep tone="attention" title={`${waiting.length} order${waiting.length === 1 ? "" : "s"} waiting for your answer`} hint="Review the article and accept or decline." href="/publisher/orders" label="Review orders" />
        : (listings ?? []).length === 0 ? <NextStep title="Add your first website" hint="Listings are reviewed by our team before customers can see them." href="/publisher/listings" label="Add a website" />
        : <NextStep title="Nothing waiting for you" hint={`${active} order${active === 1 ? "" : "s"} in progress.`} href="/publisher/orders" label="View orders" />}
      <h2 className="font-serif font-semibold text-lg mb-3">Your websites</h2>
      <ul className="grid gap-2">{(listings ?? []).map((l: any) => <li key={l.id} className="card flex justify-between items-center"><span>{l.domain}</span><StatusBadge status={l.status} /></li>)}</ul>
    </div>
  );
}
