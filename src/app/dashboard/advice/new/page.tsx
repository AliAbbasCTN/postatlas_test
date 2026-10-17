import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { startAdvice } from "@/lib/actions/advice";
import { SubmitButton } from "@/components/SubmitButton";
import { PageHeader } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { isUuid } from "@/lib/validation";
import { orgCan } from "@/lib/permissions";

export const metadata = { title: "Ask for advice" };

export default async function NewAdvice({ searchParams }: { searchParams: Promise<{ website_id?: string; opportunity_id?: string; publisher_id?: string; order_id?: string; error?: string }> }) {
  const sp = await searchParams;
  const { org } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const ctx: string[] = [];
  const hidden: Record<string, string> = {};
  if (sp.opportunity_id && isUuid(sp.opportunity_id)) {
    const { data } = await supabase.from("opportunities").select("id, page_url").eq("id", sp.opportunity_id).maybeSingle();
    if (data) { hidden.opportunity_id = data.id; ctx.push(`Page: ${new URL(data.page_url).pathname || "/"}`); }
  }
  if (sp.website_id && isUuid(sp.website_id) && !hidden.opportunity_id) {
    const { data } = await supabase.from("websites").select("id, domain").eq("id", sp.website_id).maybeSingle();
    if (data) { hidden.website_id = data.id; ctx.push(`Website: ${data.domain}`); }
  }
  if (sp.publisher_id && isUuid(sp.publisher_id)) {
    const { data } = await supabase.from("publisher_websites").select("id, domain").eq("id", sp.publisher_id).eq("status", "approved").maybeSingle();
    if (data) { hidden.publisher_id = data.id; ctx.push(`Publisher: ${data.domain}`); }
  }
  if (sp.order_id && isUuid(sp.order_id)) {
    const { data } = await supabase.from("orders").select("id").eq("id", sp.order_id).maybeSingle();
    if (data) { hidden.order_id = data.id; ctx.push("About one of your orders"); }
  }
  if (!orgCan(org.role, "askAdvice")) return <p className="text-inksoft">Your role cannot start conversations.</p>;
  return (
    <div className="max-w-xl">
      <PageHeader title="Ask for advice" subtitle="Have a question or want help deciding what makes sense for your website? Ask the PostAtlas team. You do not need to place an order." />
      <FormFeedback error={sp.error} />
      <form action={startAdvice} className="card grid gap-4">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {ctx.length > 0 && <div className="text-sm bg-mist rounded p-3"><b>We will include:</b><ul className="list-disc pl-5">{ctx.map((c) => <li key={c}>{c}</li>)}</ul></div>}
        <div><label className="label" htmlFor="subject">Subject (optional)</label><input id="subject" name="subject" maxLength={140} className="input" /></div>
        <div><label className="label" htmlFor="body">Your question</label><textarea id="body" name="body" required minLength={5} maxLength={4000} rows={6} className="input" /></div>
        <p className="text-xs text-inksoft">You will get the answer here, and we will email you a notice when we reply.</p>
        <SubmitButton pendingText="Sending..." className="btn-primary w-fit">Send question</SubmitButton>
      </form>
    </div>
  );
}
