import { formatHours } from "@/lib/order-deadline";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dismissOpportunity } from "@/lib/actions/websites";
import { PageHeader, EmptyState, Metric, Money } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { rankPublishers, explainMatch } from "@/lib/matching";
import { MATCH_SELECT, toCandidates } from "@/lib/match-data";
import { isUuid } from "@/lib/validation";
import { orgCan } from "@/lib/permissions";

export const metadata = { title: "Opportunity" };

export default async function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { workspaces } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data: opp } = await supabase.from("opportunities").select("*, websites(domain)").eq("id", id).maybeSingle();
  if (!opp) notFound();
  const site = Array.isArray(opp.websites) ? opp.websites[0] : opp.websites;

  // Only columns the public role may read; metrics only count when an admin verified them.
  const { data } = await supabase.from("publisher_websites").select(MATCH_SELECT).eq("status", "approved").limit(300);
  const candidates = toCandidates(data ?? []);
  const ranked = rankPublishers({ category: opp.category }, candidates, 12);
  const ownerRole = workspaces.find((w) => w.id === opp.organization_id)?.role;   // role in the workspace that owns this opportunity
  const canOrder = orgCan(ownerRole, "manageOrders");

  return (
    <div>
      <PageHeader title={new URL(opp.page_url).pathname || "/"} subtitle={`${site?.domain ?? ""} · Topic: ${opp.category ?? "not set"}`} />
      <div className="card mb-8">
        {opp.kind === "authority_gap" ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <Metric label="Sites linking to this page" value={opp.page_referring_domains} status="observed" source={opp.data_source} />
            <Metric label="Comparable pages" value={opp.reference_referring_domains} status="observed" source={opp.data_source} />
            <Metric label="Gap" value={opp.gap} status="calculated" />
            <Metric label="Potential relevant links" value={`${opp.est_links_min}-${opp.est_links_max}`} status="estimated" />
          </div>
        ) : (
          <p className="text-sm text-inksoft">You chose this page. We have not measured its links, so no numbers are shown. The publishers below are matched on topic and the information publishers have provided.</p>
        )}
      </div>

      <h2 className="font-serif font-semibold text-xl mb-1">Relevant publisher options</h2>
      <p className="text-sm text-inksoft mb-4">These are options, not guarantees. A placement is a link opportunity; search engines decide what it is worth.</p>
      {ranked.length === 0 ? (
        <EmptyState title="No matching publishers yet" action={{ href: `/dashboard/advice/new?opportunity_id=${opp.id}`, label: "Ask for advice" }}>
          No approved publisher covers this topic right now. Our team can suggest alternatives.
        </EmptyState>
      ) : (
        <ul className="grid gap-4">
          {ranked.map(({ candidate: c, match }) => (
            <li key={c.websiteId} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="font-serif font-semibold text-lg">{c.domain}</div><div className="text-xs text-inksoft">{c.niche ?? "No topic"}{c.country ? ` · ${c.country}` : ""}</div></div>
                <div className="text-right"><Money value={c.priceGuestPost ?? c.priceLinkInsertion} /><div className="text-xs text-inksoft">{c.priceGuestPost != null ? "guest post" : "link insertion"}</div></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {c.metrics?.verified && c.metrics.dr != null ? <StatusBadge status="VERIFIED" label={`DR ${c.metrics.dr} (verified)`} /> : <StatusBadge status="NEEDS_REVIEW" label="Authority not verified" />}
                {c.metrics?.verified && c.metrics.organicTraffic != null && <StatusBadge status="VERIFIED" label={`Traffic ${c.metrics.organicTraffic.toLocaleString("en-US")} (verified)`} />}
                {c.linkType && <StatusBadge status={c.linkType === "dofollow" ? "VERIFIED" : "NEEDS_REVIEW"} label={c.linkType} />}
                {c.turnaroundMax != null && <StatusBadge status="NEEDS_REVIEW" label={`Up to ${formatHours(c.turnaroundMax)}`} />}
              </div>
              <p className="text-sm mt-3">{explainMatch(match)}</p>
              {match.cautions.length > 0 && <ul className="text-xs text-inksoft mt-2 list-disc pl-5">{match.cautions.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>}
              <div className="flex flex-wrap gap-3 mt-4">
                <Link className="btn" href={`/publishers/${encodeURIComponent(c.domain)}`}>View publisher</Link>
                {canOrder && <Link className="btn-primary" href={`/dashboard/orders/new?publisher=${c.websiteId}&opportunity=${opp.id}`}>Order this placement</Link>}
                <Link className="btn" href={`/dashboard/advice/new?opportunity_id=${opp.id}&publisher_id=${c.websiteId}`}>Ask for advice</Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="card mt-10 bg-mist">
        <h2 className="font-serif font-semibold text-lg">Not ready to order?</h2>
        <p className="text-sm text-inksoft mt-1 mb-3">Have a question or want help deciding what makes sense for your website? Talk to the PostAtlas team. No order needed.</p>
        <Link className="btn-primary" href={`/dashboard/advice/new?opportunity_id=${opp.id}`}>Ask for Advice</Link>
      </div>
      {orgCan(ownerRole, "manageWebsites") && (
        <form action={dismissOpportunity} className="mt-6"><input type="hidden" name="opportunity_id" value={opp.id} /><button className="text-sm text-inksoft underline">Remove this opportunity from my list</button></form>
      )}
    </div>
  );
}
