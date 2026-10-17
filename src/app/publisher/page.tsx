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
  const list: any[] = listings ?? [];
  const hasListing = list.length > 0;
  const hasApproved = list.some((l) => l.status === "approved");
  const setup: [string, string, boolean][] = [
    ["Publisher application approved", "Our team approved your account.", true],
    ["Add your first website", "Domain, topic, prices and requirements.", hasListing],
    ["Website approved", "Customers can see and order from it.", hasApproved]
  ];
  const statusHint: Record<string, string> = {
    pending_review: "Our team is reviewing this website. Customers cannot see it yet.",
    approved: "Live. Customers can order from this website.",
    rejected: "Not approved. Open My websites to see the reason and fix it.",
    suspended: "Paused by our team. Contact support if you think this is a mistake."
  };
  return (
    <div>
      <PageHeader title="Overview" subtitle={profile?.display_name} />
      {waiting.length > 0 ? <NextStep tone="attention" title={`${waiting.length} order${waiting.length === 1 ? "" : "s"} waiting for your answer`} hint="Review the article and accept or decline." href="/publisher/orders" label="Review orders" />
        : (listings ?? []).length === 0 ? <NextStep title="Add your first website" hint="Listings are reviewed by our team before customers can see them." href="/publisher/listings" label="Add a website" />
        : <NextStep title="Nothing waiting for you" hint={`${active} order${active === 1 ? "" : "s"} in progress.`} href="/publisher/orders" label="View orders" />}
      {!hasApproved && (
        <section aria-labelledby="setup" className="card mb-8">
          <h2 id="setup" className="mb-3 text-base font-semibold">Getting started</h2>
          <ol className="grid gap-2 text-sm">
            {setup.map(([t, d, done]) => (
              <li key={t} className="flex items-start gap-3">
                <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${done ? "bg-verdigris text-white" : "border border-inputborder text-inksoft"}`}>{done ? "✓" : ""}</span>
                <span><strong className="text-ink">{t}</strong>{done ? <span className="sr-only"> (done)</span> : <span className="sr-only"> (not done yet)</span>}<span className="block text-inksoft">{d}</span></span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <h2 className="mb-3 text-base font-semibold">Your websites</h2>
      {list.length === 0 ? <p className="text-sm text-inksoft">No websites yet. Add one to start receiving orders.</p> : (
        <ul className="grid gap-2">{list.map((l) => <li key={l.id} className="card flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="font-medium">{l.domain}</div><div className="text-sm text-inksoft">{statusHint[l.status] ?? ""}</div></div><StatusBadge status={l.status} /></li>)}</ul>
      )}
    </div>
  );
}
