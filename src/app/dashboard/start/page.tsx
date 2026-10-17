import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { startFromCheck } from "@/lib/actions/websites";
import { SubmitButton } from "@/components/SubmitButton";
import { FormFeedback } from "@/components/FormFeedback";
import { Money } from "@/components/ui";
import { isUuid } from "@/lib/validation";
import { orgCan } from "@/lib/permissions";

export const metadata = { title: "Continue your order" };

// Landing page after a visitor chose a publisher on a public report and signed in. A POST button (never a
// side-effecting GET link) adds the website to their account, then continues to the order form.
export default async function StartFromCheck({ searchParams }: { searchParams: Promise<{ check?: string; publisher?: string; error?: string }> }) {
  const sp = await searchParams;
  const { org } = await requireWorkspace();
  if (!sp.check || !sp.publisher || !isUuid(sp.check) || !isUuid(sp.publisher)) notFound();
  const db = createAdminClient();
  const { data: check } = await db.from("site_checks").select("domain, category, result").eq("id", sp.check).maybeSingle();
  const { data: pub } = await createPublicClient().from("publisher_websites").select("id, domain, niche, price_guest_post, price_link_insertion").eq("id", sp.publisher).eq("status", "approved").maybeSingle();
  if (!check || !pub) notFound();
  const pages = [`https://${check.domain}/`, ...(((check.result?.pages ?? []) as { url: string; status: number | null; noindex: boolean | null }[]).filter((p) => p.status === 200 && p.noindex !== true).map((p) => p.url))];

  if (!orgCan(org.role, "manageWebsites")) return <p className="text-inksoft">Your role in this team cannot add websites or place orders. Ask a team owner, or switch to your personal account in Settings.</p>;
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">You are almost there</h1>
      <p className="text-inksoft mb-6">We will add <b>{check.domain}</b> to your account, then you can review the order before paying. Nothing is charged yet.</p>
      <FormFeedback error={sp.error} />
      <div className="card mb-6 text-sm"><div className="text-xs text-inksoft mb-1">Chosen publisher</div><div className="font-serif font-semibold text-lg">{pub.domain}</div><div className="text-inksoft">{pub.niche ?? "General"} · from <Money value={pub.price_guest_post ?? pub.price_link_insertion} /></div></div>
      <form action={startFromCheck} className="card grid gap-4">
        <input type="hidden" name="check" value={sp.check} />
        <input type="hidden" name="publisher" value={sp.publisher} />
        <div><label className="label" htmlFor="target">Which page should the link point to?</label>
          <select id="target" name="target" className="input">{pages.map((u, i) => <option key={u} value={u}>{i === 0 ? "Homepage" : new URL(u).pathname}</option>)}</select></div>
        <SubmitButton pendingText="Setting things up..." className="btn-primary w-fit">Continue to order details</SubmitButton>
      </form>
      <p className="text-sm text-inksoft mt-5"><Link className="underline text-accenttext" href={`/check/${sp.check}`}>Back to your report</Link></p>
    </div>
  );
}
