import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addWebsite } from "@/lib/actions/websites";
import { SubmitButton } from "@/components/SubmitButton";
import { PageHeader, EmptyState, fmtDate } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { NICHES } from "@/lib/niches";
import { orgCan } from "@/lib/permissions";

export const metadata = { title: "Websites" };

export default async function WebsitesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const { org } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("websites").select("id, domain, category, last_audit_at").eq("organization_id", org.id).order("created_at", { ascending: true }).limit(25);
  const sites: any[] = data ?? [];
  const canManage = orgCan(org.role, "manageWebsites");
  return (
    <div>
      <PageHeader title="Websites" subtitle="The websites you want to build authority for." />
      <FormFeedback error={sp.error} />
      {sites.length === 0 ? (
        <div className="mb-8"><EmptyState title="Add your first website">Enter the address of your website and its main topic. We will look at your pages next.</EmptyState></div>
      ) : (
        <ul className="grid gap-3 mb-10">
          {sites.map((w) => (
            <li key={w.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-serif font-semibold">{w.domain}</div><div className="text-xs text-inksoft">{w.category} · {w.last_audit_at ? `Analyzed ${fmtDate(w.last_audit_at)}` : "Not analyzed yet"}</div></div>
              <Link className="btn-primary" href={`/dashboard/websites/${w.id}`}>{w.last_audit_at ? "Open" : "Analyze website"}</Link>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form action={addWebsite} className="card max-w-lg">
          <h2 className="font-serif font-semibold text-lg mb-4">Add a website</h2>
          <div className="mb-4"><label className="label" htmlFor="domain">Website address</label><input id="domain" name="domain" required maxLength={300} placeholder="example.com" className="input" /></div>
          <div className="mb-5"><label className="label" htmlFor="category">Main topic</label>
            <select id="category" name="category" required className="input">{NICHES.map((n) => <option key={n}>{n}</option>)}</select></div>
          <SubmitButton pendingText="Adding..." className="btn-primary">Add website</SubmitButton>
        </form>
      )}
    </div>
  );
}
