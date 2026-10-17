import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { postAdviceMessage, closeAdviceThread } from "@/lib/actions/advice";
import { PageHeader, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import { isUuid } from "@/lib/validation";

export const metadata = { title: "Conversation" };

export default async function AdviceThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data: thread } = await supabase.from("advice_threads").select("id, subject, status, awaiting, opportunity_id, order_id").eq("id", id).maybeSingle();
  if (!thread) notFound();
  const { data: messages } = await supabase.from("advice_messages").select("id, sender_role, body, created_at").eq("thread_id", id).order("created_at").limit(200);
  return (
    <div className="max-w-2xl">
      <PageHeader title={thread.subject} action={thread.status === "CLOSED" ? <StatusBadge status="NEEDS_REVIEW" label="Closed" /> : undefined} />
      <FormFeedback error={sp.error} />
      <ol className="grid gap-3 mb-6" aria-live="polite">
        {(messages ?? []).map((m: any) => (
          <li key={m.id} className={`rounded-md p-4 text-sm border ${m.sender_role === "team" ? "bg-[#E4EEEA] border-verdigris" : "bg-white border-line"}`}>
            <div className="text-xs text-inksoft mb-1">{m.sender_role === "team" ? "PostAtlas team" : "You"} · {fmtDateTime(m.created_at)}</div>
            <div className="whitespace-pre-line break-words">{m.body}</div>
          </li>
        ))}
      </ol>
      <form action={postAdviceMessage} className="card grid gap-3">
        <input type="hidden" name="thread_id" value={thread.id} />
        <label className="label" htmlFor="body">{thread.status === "CLOSED" ? "Reopen with a message" : "Reply"}</label>
        <textarea id="body" name="body" required maxLength={4000} rows={4} className="input" />
        <button className="btn-primary w-fit">Send</button>
      </form>
      {thread.status === "OPEN" && <form action={closeAdviceThread} className="mt-4"><input type="hidden" name="thread_id" value={thread.id} /><button className="text-sm text-inksoft underline">Mark as resolved</button></form>}
      {thread.opportunity_id && <p className="mt-6 text-sm"><a className="underline text-accenttext" href={`/dashboard/opportunities/${thread.opportunity_id}`}>Back to the opportunity</a></p>}
    </div>
  );
}
