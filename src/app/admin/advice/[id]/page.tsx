import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { postAdviceMessage, closeAdviceThread } from "@/lib/actions/advice";
import { PageHeader, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { isUuid } from "@/lib/validation";

export const metadata = { title: "Advice conversation" };

export default async function AdminAdviceThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  await requireAdmin();
  const db = createAdminClient();
  const { data: t } = await db.from("advice_threads").select("id, subject, status, organizations(name), websites(domain), opportunities(id, page_url), publisher_websites(domain), order_id").eq("id", id).maybeSingle();
  if (!t) notFound();
  const { data: msgs } = await db.from("advice_messages").select("id, sender_role, body, created_at").eq("thread_id", id).order("created_at").limit(300);
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  const org = one(t.organizations), site = one(t.websites), opp = one(t.opportunities), pub = one(t.publisher_websites);
  return (
    <div className="max-w-2xl">
      <PageHeader title={t.subject} subtitle={org?.name} />
      <FormFeedback error={sp.error} />
      <div className="card text-sm mb-6"><b>Context</b><ul className="list-disc pl-5 text-inksoft">{site && <li>Website: {site.domain}</li>}{opp && <li>Page: {opp.page_url}</li>}{pub && <li>Publisher considered: {pub.domain}</li>}{t.order_id && <li><Link className="underline" href={`/admin/orders/${t.order_id}`}>Related order</Link></li>}{!site && !opp && !pub && !t.order_id && <li>None attached</li>}</ul></div>
      <ol className="grid gap-3 mb-6">{(msgs ?? []).map((m: any) => <li key={m.id} className={`rounded-md p-4 text-sm border ${m.sender_role === "team" ? "bg-[#E4EEEA] border-verdigris" : "bg-white border-line"}`}><div className="text-xs text-inksoft mb-1">{m.sender_role === "team" ? "PostAtlas team" : "Customer"} · {fmtDateTime(m.created_at)}</div><div className="whitespace-pre-line break-words">{m.body}</div></li>)}</ol>
      <form action={postAdviceMessage} className="card grid gap-3"><input type="hidden" name="thread_id" value={t.id} /><label className="label" htmlFor="body">Reply (the customer is notified by email)</label><textarea id="body" name="body" required maxLength={4000} rows={5} className="input" /><button className="btn-primary w-fit">Send reply</button></form>
      {t.status === "OPEN" && <form action={closeAdviceThread} className="mt-4"><input type="hidden" name="thread_id" value={t.id} /><button className="text-sm underline text-inksoft">Close conversation</button></form>}
    </div>
  );
}
