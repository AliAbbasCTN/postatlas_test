import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewPublisherApplication, reviewListing, verifyMetrics } from "@/lib/actions/publishers";
import { PageHeader, EmptyState, Pagination, parsePage } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Publishers" };
const PAGE = 15;
const STATUSES = ["pending_review", "approved", "rejected", "suspended"];

export default async function AdminPublishers({ searchParams }: { searchParams: Promise<{ error?: string; page?: string; status?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const page = parsePage(sp.page);
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "pending_review";
  const db = createAdminClient();
  const [{ data: apps }, { data, count }] = await Promise.all([
    db.from("publisher_profiles").select("id, display_name, bio, approved, profiles(email)").eq("approved", false).order("created_at").limit(50),
    db.from("publisher_websites").select("*, publisher_profiles(display_name), publisher_metrics(dr, da, organic_traffic, spam_score, verified, metrics_source, verification_note)", { count: "exact" }).eq("status", status).order("created_at").range((page - 1) * PAGE, page * PAGE - 1)
  ]);
  return (
    <div>
      <PageHeader title="Publishers" subtitle="Approve people, approve listings, and verify figures separately." />
      <FormFeedback error={sp.error} />
      <h2 className="font-serif font-semibold text-xl mb-3">Applications</h2>
      {(apps ?? []).length === 0 ? <p className="text-sm text-inksoft mb-8">No applications waiting.</p> : (
        <ul className="grid gap-3 mb-10">{(apps ?? []).map((a: any) => { const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles; return (
          <li key={a.id} className="card"><div className="font-medium">{a.display_name} <span className="text-xs text-inksoft">{p?.email}</span></div><p className="text-sm text-inksoft whitespace-pre-line my-2">{a.bio}</p>
            <div className="flex gap-2"><form action={reviewPublisherApplication}><input type="hidden" name="profile_id" value={a.id} /><input type="hidden" name="decision" value="approve" /><button className="btn-primary">Approve as publisher</button></form>
              <form action={reviewPublisherApplication}><input type="hidden" name="profile_id" value={a.id} /><input type="hidden" name="decision" value="reject" /><button className="btn">Reject</button></form></div></li>); })}</ul>)}

      <h2 className="font-serif font-semibold text-xl mb-3">Listings</h2>
      <nav aria-label="Listing status" className="flex flex-wrap gap-2 mb-4 text-sm">{STATUSES.map((s) => <a key={s} href={`/admin/publishers?status=${s}`} aria-current={s === status ? "page" : undefined} className={`px-3 py-1.5 rounded border ${s === status ? "bg-navy text-paper border-ink" : "border-line"}`}>{s.replace("_", " ")}</a>)}</nav>
      {(data ?? []).length === 0 ? <EmptyState title="No listings in this state" /> : (
        <ul className="grid gap-4">{(data ?? []).map((l: any) => { const m = Array.isArray(l.publisher_metrics) ? l.publisher_metrics[0] : l.publisher_metrics; const pp = Array.isArray(l.publisher_profiles) ? l.publisher_profiles[0] : l.publisher_profiles; return (
          <li key={l.id} className="card">
            <div className="flex flex-wrap justify-between gap-3"><div><div className="font-serif font-semibold text-lg">{l.domain}</div><div className="text-xs text-inksoft">{pp?.display_name} · {l.niche} · {l.country ?? "-"} · {l.link_type ?? "-"} · guest ${l.price_guest_post ?? "-"} / insertion ${l.price_link_insertion ?? "-"}</div></div><StatusBadge status={l.status} /></div>
            {l.description && <p className="text-sm mt-2 whitespace-pre-line">{l.description}</p>}
            <div className="text-sm mt-3">Figures {m?.verified ? <StatusBadge status="VERIFIED" label="verified" /> : <StatusBadge status="NEEDS_REVIEW" label="reported by publisher, unverified" />}: DR {m?.dr ?? "-"} · DA {m?.da ?? "-"} · traffic {m?.organic_traffic ?? "-"} · spam {m?.spam_score ?? "-"}</div>
            <details className="mt-3"><summary className="cursor-pointer text-sm underline">Record verified figures</summary>
              <form action={verifyMetrics} className="grid sm:grid-cols-4 gap-3 mt-3"><input type="hidden" name="listing_id" value={l.id} />
                <div><label className="label" htmlFor={`dr${l.id}`}>DR</label><input id={`dr${l.id}`} name="dr" defaultValue={m?.dr ?? ""} className="input" /></div>
                <div><label className="label" htmlFor={`da${l.id}`}>DA</label><input id={`da${l.id}`} name="da" defaultValue={m?.da ?? ""} className="input" /></div>
                <div><label className="label" htmlFor={`tr${l.id}`}>Traffic</label><input id={`tr${l.id}`} name="organic_traffic" defaultValue={m?.organic_traffic ?? ""} className="input" /></div>
                <div><label className="label" htmlFor={`sp${l.id}`}>Spam score</label><input id={`sp${l.id}`} name="spam_score" defaultValue={m?.spam_score ?? ""} className="input" /></div>
                <div className="sm:col-span-3"><label className="label" htmlFor={`nt${l.id}`}>Source of these figures</label><input id={`nt${l.id}`} name="note" required minLength={5} maxLength={300} placeholder="e.g. checked in our SEO tool on 3 Oct" className="input" /></div>
                <div className="self-end"><button className="btn-primary">Mark verified</button></div></form></details>
            <div className="flex flex-wrap gap-3 mt-4 border-t border-line pt-4">
              {l.status !== "approved" && <form action={reviewListing}><input type="hidden" name="listing_id" value={l.id} /><input type="hidden" name="decision" value="approve" /><button className="btn-primary">Approve listing</button></form>}
              <form action={reviewListing} className="flex flex-wrap gap-2"><input type="hidden" name="listing_id" value={l.id} /><label className="sr-only" htmlFor={`rs${l.id}`}>Reason</label><input id={`rs${l.id}`} name="reason" required maxLength={500} placeholder="Reason" className="input w-56" />
                {l.status !== "rejected" && <button name="decision" value="reject" className="btn">Reject</button>}{l.status === "approved" && <button name="decision" value="suspend" className="btn-danger">Suspend</button>}</form>
            </div>
          </li>); })}</ul>)}
      <Pagination basePath="/admin/publishers" page={page} pageSize={PAGE} total={count ?? 0} params={{ status: sp.status }} />
    </div>
  );
}
