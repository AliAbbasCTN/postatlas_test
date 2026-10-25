import { requirePublisher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveListing } from "@/lib/actions/publishers";
import { PageHeader } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import { NICHES } from "@/lib/niches";

export const metadata = { title: "My websites" };

function ListingForm({ l, m }: { l?: any; m?: any }) {
  return (
    <form action={saveListing} className="grid gap-4 sm:grid-cols-2">
      {l && <input type="hidden" name="listing_id" value={l.id} />}
      <div><label className="label" htmlFor={`d${l?.id}`}>Domain</label><input id={`d${l?.id}`} name="domain" required maxLength={300} defaultValue={l?.domain} className="input" /></div>
      <div><label className="label" htmlFor={`n${l?.id}`}>Topic</label><select id={`n${l?.id}`} name="niche" required defaultValue={l?.niche ?? ""} className="input"><option value="" disabled>Choose...</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select></div>
      <div><label className="label" htmlFor={`g${l?.id}`}>Guest post price (USD)</label><input id={`g${l?.id}`} name="price_guest_post" inputMode="decimal" defaultValue={l?.price_guest_post ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`i${l?.id}`}>Link insertion price (USD)</label><input id={`i${l?.id}`} name="price_link_insertion" inputMode="decimal" defaultValue={l?.price_link_insertion ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`t1${l?.id}`}>Fastest turnaround (hours)</label><input id={`t1${l?.id}`} name="turnaround_hours_min" inputMode="numeric" placeholder="e.g. 24" defaultValue={l?.turnaround_hours_min ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`t2${l?.id}`}>Slowest turnaround (hours)</label><input id={`t2${l?.id}`} name="turnaround_hours_max" inputMode="numeric" placeholder="e.g. 48" aria-describedby={`t2h${l?.id}`} defaultValue={l?.turnaround_hours_max ?? ""} className="input" /><p id={`t2h${l?.id}`} className="mt-1 text-xs text-inksoft">In hours (48 = two days). This is your delivery deadline: the countdown starts when you accept an order.</p></div>
      <div><label className="label" htmlFor={`lt${l?.id}`}>Link type</label><select id={`lt${l?.id}`} name="link_type" required defaultValue={l?.link_type ?? "dofollow"} className="input"><option>dofollow</option><option>nofollow</option><option>mixed</option></select></div>
      <div><label className="label" htmlFor={`c${l?.id}`}>Country</label><input id={`c${l?.id}`} name="country" maxLength={60} defaultValue={l?.country ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`la${l?.id}`}>Language</label><input id={`la${l?.id}`} name="language" maxLength={40} defaultValue={l?.language ?? ""} className="input" /></div>
      <fieldset className="sm:col-span-2 grid grid-cols-3 gap-3 border border-line rounded p-3"><legend className="text-sm px-1">Your own figures (shown as &quot;reported by publisher&quot; until we verify them)</legend>
        <div><label className="label" htmlFor={`dr${l?.id}`}>DR</label><input id={`dr${l?.id}`} name="dr" inputMode="numeric" defaultValue={m?.dr ?? ""} className="input" /></div>
        <div><label className="label" htmlFor={`da${l?.id}`}>DA</label><input id={`da${l?.id}`} name="da" inputMode="numeric" defaultValue={m?.da ?? ""} className="input" /></div>
        <div><label className="label" htmlFor={`tr${l?.id}`}>Monthly traffic</label><input id={`tr${l?.id}`} name="organic_traffic" inputMode="numeric" defaultValue={m?.organic_traffic ?? ""} className="input" /></div></fieldset>
      <div className="sm:col-span-2"><label className="label" htmlFor={`ds${l?.id}`}>Description</label><textarea id={`ds${l?.id}`} name="description" rows={3} maxLength={1000} defaultValue={l?.description ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor={`ar${l?.id}`}>Content requirements</label><textarea id={`ar${l?.id}`} name="article_requirements" rows={3} maxLength={2000} defaultValue={l?.article_requirements ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><button className="btn-primary">{l ? "Save changes and resubmit for review" : "Submit for review"}</button></div>
    </form>
  );
}

export default async function PublisherListings({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const { user } = await requirePublisher();
  const db = createAdminClient();
  const { data: profile } = await db.from("publisher_profiles").select("id, approved").eq("user_id", user.id).maybeSingle();
  const { data } = profile ? await db.from("publisher_websites").select("*, publisher_metrics(dr, da, organic_traffic, verified, metrics_source)").eq("publisher_id", profile.id).order("created_at") : { data: [] as any[] };
  return (
    <div>
      <PageHeader title="My websites" subtitle="Every new or edited listing is reviewed by our team before customers can order from it." />
      <FormFeedback error={sp.error} success={sp.saved ? "Saved. Your listing is waiting for review." : undefined} />
      {(data ?? []).map((l: any) => { const m = Array.isArray(l.publisher_metrics) ? l.publisher_metrics[0] : l.publisher_metrics; return (
        <details key={l.id} className="card mb-4"><summary className="cursor-pointer flex items-center justify-between gap-3"><span className="font-serif font-semibold">{l.domain}</span><span className="flex gap-2"><StatusBadge status={l.status} />{m?.verified ? <StatusBadge status="VERIFIED" label="Figures verified" /> : <StatusBadge status="NEEDS_REVIEW" label="Figures unverified" />}</span></summary>
          {l.status === "rejected" && l.rejection_reason && <p className="text-sm text-redsig mt-3">Reason: {l.rejection_reason}</p>}
          <div className="mt-4"><ListingForm l={l} m={m} /></div></details>); })}
      <div className="card mt-6"><h2 className="font-serif font-semibold text-lg mb-4">Add a website</h2><ListingForm /></div>
    </div>
  );
}
