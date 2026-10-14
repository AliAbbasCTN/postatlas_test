import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { compareOpportunities } from "@/lib/opportunity";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const { org } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("opportunities")
    .select("id, page_url, page_title, category, kind, level, page_referring_domains, reference_referring_domains, gap, est_links_min, est_links_max, websites(domain)")
    .eq("organization_id", org.id).eq("status", "OPEN").limit(100);
  const rows: any[] = (data ?? []).sort((a: any, b: any) => compareOpportunities(a, b));
  return (
    <div>
      <PageHeader title="Opportunities" subtitle="Pages on your websites that are worth strengthening, and where relevant publishers can help." />
      {rows.length === 0 ? (
        <EmptyState title="No opportunities yet" action={{ href: "/dashboard/websites", label: "Go to websites" }}>
          Analyze a website and choose a page, and it will appear here.
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-inksoft mb-4">{rows.length} page{rows.length === 1 ? "" : "s"} to look at</p>
          <ul className="grid gap-3">
            {rows.map((o) => {
              const site = Array.isArray(o.websites) ? o.websites[0] : o.websites;
              return (
                <li key={o.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><div className="font-serif font-semibold break-all">{new URL(o.page_url).pathname || "/"}</div><div className="text-xs text-inksoft">{site?.domain} · {o.category ?? "No topic"}</div></div>
                    {o.kind === "authority_gap" ? <StatusBadge status={o.level === "HIGH" ? "ISSUE" : o.level === "MEDIUM" ? "PENDING" : "NEEDS_REVIEW"} label={`${o.level[0]}${o.level.slice(1).toLowerCase()} opportunity`} /> : <StatusBadge status="NEEDS_REVIEW" label="Chosen by you" />}
                  </div>
                  {o.kind === "authority_gap" && (
                    <p className="text-sm mt-3">Sites linking to this page: <b className="font-mono">{o.page_referring_domains}</b> (observed) · comparable pages: <b className="font-mono">{o.reference_referring_domains}</b> (observed) · potential: <b className="font-mono">{o.est_links_min}-{o.est_links_max}</b> relevant links (estimate)</p>
                  )}
                  <div className="mt-4"><Link className="btn-primary" href={`/dashboard/opportunities/${o.id}`}>Find matching publishers</Link></div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
