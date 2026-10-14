import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { analyzeWebsite, selectPageAsOpportunity } from "@/lib/actions/websites";
import { PageHeader, EmptyState, NextStep, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import { isUuid } from "@/lib/validation";
import { orgCan } from "@/lib/permissions";

export const metadata = { title: "Website" };

export default async function WebsiteDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; added?: string; analyzed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const { workspaces } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data: site } = await supabase.from("websites").select("id, organization_id, domain, category, last_audit_at").eq("id", id).maybeSingle();
  if (!site) notFound();
  const { data: audit } = await supabase.from("audits").select("id, status, pages_found, link_data_status, created_at, error").eq("website_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: pages } = audit ? await supabase.from("audit_pages").select("url, http_status, title, noindex").eq("audit_id", audit.id).order("url").limit(50) : { data: [] as any[] };
  const { data: opps } = await supabase.from("opportunities").select("id, page_url, kind, level, status").eq("website_id", id).eq("status", "OPEN");
  const oppByUrl = new Map<string, any>((opps ?? []).map((o: any) => [o.page_url, o]));
  const canManage = orgCan(workspaces.find((w) => w.id === site.organization_id)?.role, "manageWebsites");

  return (
    <div>
      <PageHeader title={site.domain} subtitle={`Topic: ${site.category}`}
        action={canManage && (
          <form action={analyzeWebsite}><input type="hidden" name="website_id" value={site.id} /><button className="btn-primary">{audit ? "Analyze again" : "Analyze website"}</button></form>
        )} />
      <FormFeedback error={sp.error} success={sp.analyzed ? "Analysis complete." : sp.added ? "Website added. Run the analysis to see your pages." : undefined} />
      {!audit && <NextStep title="Analyze this website" hint="We fetch your public pages and check how they look to search engines." href="#" label="Use the Analyze button above" />}

      {audit && (
        <>
          <div className="card mb-6 text-sm">
            <div className="flex flex-wrap gap-6">
              <div><div className="text-xs text-inksoft">Last analysis</div>{fmtDateTime(audit.created_at)}</div>
              <div><div className="text-xs text-inksoft">Pages found</div><span className="font-mono">{audit.pages_found}</span> <span className="text-xs text-inksoft">(observed)</span></div>
              <div><div className="text-xs text-inksoft">Link data</div>{audit.link_data_status === "ok" ? "Available" : "Not connected"}</div>
            </div>
            {audit.link_data_status !== "ok" && (
              <p className="mt-3 text-inksoft">We could not measure how many websites link to each page, because no link-data source is connected. We will not guess. You can still choose any page below to strengthen, or <Link className="underline text-verdigrisdark" href={`/dashboard/advice/new?website_id=${site.id}`}>ask us for advice</Link>.</p>
            )}
            {audit.status === "FAILED" && <p className="mt-3 text-redsig">The last analysis did not finish. Please try again.</p>}
          </div>

          <h2 className="font-serif font-semibold text-xl mb-3">Pages we found</h2>
          {(pages ?? []).length === 0 ? <EmptyState title="No pages could be read">Check that the website is public and try again.</EmptyState> : (
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">Page</th><th className="p-3">Response</th><th className="p-3"></th></tr></thead>
                <tbody>
                  {(pages ?? []).map((p: any) => {
                    const opp = oppByUrl.get(p.url);
                    const usable = p.http_status === 200 && p.noindex !== true;
                    return (
                      <tr key={p.url} className="border-b border-line last:border-0 align-top">
                        <td className="p-3 break-all"><div className="font-medium">{p.title ?? "(no title)"}</div><div className="text-xs text-inksoft">{p.url}</div></td>
                        <td className="p-3 whitespace-nowrap">{p.http_status ?? "No response"}{p.noindex ? <div className="text-xs text-redsig">Asks not to be indexed</div> : null}</td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {opp ? <Link className="btn" href={`/dashboard/opportunities/${opp.id}`}>View opportunity</Link>
                            : usable && canManage ? <form action={selectPageAsOpportunity}><input type="hidden" name="website_id" value={site.id} /><input type="hidden" name="page_url" value={p.url} /><button className="btn">Find publishers for this page</button></form>
                            : <StatusBadge status="NEEDS_REVIEW" label="Not eligible" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
