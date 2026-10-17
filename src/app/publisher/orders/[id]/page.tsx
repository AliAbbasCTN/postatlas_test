import { notFound } from "next/navigation";
import { requirePublisher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderFor } from "@/lib/services/orders";
import { acceptOrder, rejectOrder, startWork, submitPublishedUrl, requestRestorationCheck } from "@/lib/actions/fulfillment";
import { addDisputeMessage } from "@/lib/actions/disputes";
import { PageHeader, fmtDateTime } from "@/components/ui";
import { DeadlineNotice } from "@/components/DeadlineNotice";
import { StatusBadge } from "@/components/StatusBadge";
import { FormFeedback } from "@/components/FormFeedback";
import { isUuid } from "@/lib/validation";
import type { OrderStatus } from "@/lib/types";

export const metadata = { title: "Order" };
const VISIBLE: OrderStatus[] = ["PENDING_PUBLISHER", "ACCEPTED", "IN_PROGRESS", "PUBLISHED", "VERIFICATION_PENDING", "VERIFIED", "MONITORING", "ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "COMPLETED", "PUBLISHER_REJECTED", "DISPUTED"];

export default async function PublisherOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const { user } = await requirePublisher();
  const order = await loadOrderFor(id, { kind: "publisher", userId: user.id });
  if (!order || !VISIBLE.includes(order.status as OrderStatus)) notFound();
  const db = createAdminClient();
  // Only what the publisher needs: no customer identity, price paid, or payment data.
  const [{ data: sub }, { data: placement }, { data: dispute }] = await Promise.all([
    db.from("content_submissions").select("title, body, instructions, word_count").eq("order_id", id).maybeSingle(),
    db.from("published_placements").select("id, published_url, health, last_checked_at").eq("order_id", id).maybeSingle(),
    db.from("disputes").select("id, category, reason, status, resolution").eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const { data: restoration } = order.status === "ISSUE_DETECTED" ? await db.from("recovery_cases").select("deadline_at").eq("order_id", id).eq("kind", "link_restoration").in("status", ["OPEN", "ESCALATED"]).maybeSingle() : { data: null };
  const { data: dMsgs } = dispute ? await db.from("dispute_messages").select("sender_role, body, created_at").eq("dispute_id", dispute.id).order("created_at").limit(100) : { data: [] as any[] };
  const status = order.status as OrderStatus;
  const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Order for ${site?.domain}`} subtitle={order.order_type === "guest_post" ? "Guest post" : "Link in an existing article"} action={<StatusBadge status={status} />} />
      <FormFeedback error={sp.error} success={sp.notice} />
      <DeadlineNotice status={status} dueAt={order.due_at} turnaroundHours={order.turnaround_hours} viewer="publisher" />
      {status === "PUBLISHER_REJECTED" && order.expiry_choice && <p className="mb-6 rounded-md border border-line bg-white p-4 text-sm text-inksoft">The delivery deadline passed and the customer closed this order. It is closed for you and no payout is due.</p>}
      <section className="card mb-6 text-sm grid gap-2">
        <div><span className="text-inksoft">Link to:</span> <span className="break-all">{order.target_url}</span></div>
        <div><span className="text-inksoft">Link text:</span> {order.anchor_text ?? "Publisher's choice"}</div>
      </section>
      {sub && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-1">{sub.title}</h2>
          <div className="text-xs text-inksoft mb-3">{sub.word_count} words · shown as plain text</div>
          {sub.instructions && <div className="text-sm bg-mist rounded p-3 mb-3 whitespace-pre-line"><b>Customer instructions</b><div>{sub.instructions}</div></div>}
          {sub.body && <pre className="whitespace-pre-wrap break-words text-sm font-sans max-h-[480px] overflow-auto">{sub.body}</pre>}</section>
      )}

      {status === "ISSUE_DETECTED" && (
        <section className="card mb-6 border-amber"><h2 className="font-serif font-semibold text-lg mb-1">Please restore this link</h2>
          <p className="text-sm mb-3">Our checks found that the link we verified earlier is no longer on the page{restoration ? <>. Please restore it under the original order terms by <b>{fmtDateTime(restoration.deadline_at)}</b></> : ""}. This is at no extra charge to the customer and does not change your original compensation; no second payout is created. If you cannot restore it, tell us so we can arrange a replacement.</p>
          <form action={requestRestorationCheck}><input type="hidden" name="order_id" value={order.id} /><button className="btn-primary">I have restored it: check now</button></form></section>
      )}

      {status === "PENDING_PUBLISHER" && (
        <section className="card mb-6 grid gap-4"><h2 className="font-serif font-semibold text-lg">Your decision</h2>
          <form action={acceptOrder}><input type="hidden" name="order_id" value={order.id} /><button className="btn-primary">Accept this order</button></form>
          <form action={rejectOrder} className="grid gap-2 max-w-md border-t border-line pt-4"><input type="hidden" name="order_id" value={order.id} />
            <label className="label" htmlFor="reason">Or decline, with a reason</label><textarea id="reason" name="reason" required minLength={10} maxLength={1000} rows={3} className="input" /><button className="btn-danger w-fit">Decline</button></form>
        </section>
      )}
      {status === "ACCEPTED" && <form action={startWork} className="mb-6"><input type="hidden" name="order_id" value={order.id} /><button className="btn">Mark as in progress</button></form>}
      {["ACCEPTED", "IN_PROGRESS", "VERIFICATION_PENDING"].includes(status) && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-2">{status === "VERIFICATION_PENDING" ? "Resubmit the published URL" : "Submit the published URL"}</h2>
          <p className="text-sm text-inksoft mb-3">Enter the live address on {site?.domain}. We check that the link is really on the page before the order moves on.</p>
          <form action={submitPublishedUrl} className="grid gap-3 max-w-lg"><input type="hidden" name="order_id" value={order.id} />
            <label className="label" htmlFor="published_url">Published URL</label><input id="published_url" name="published_url" type="url" required maxLength={2048} className="input" /><button className="btn-primary w-fit">Submit and check</button></form>
        </section>
      )}
      {placement && <section className="card mb-6 text-sm"><h2 className="font-serif font-semibold text-lg mb-2">Published page</h2><a className="underline break-all text-accenttext" href={placement.published_url} target="_blank" rel="noopener noreferrer nofollow">{placement.published_url}</a>
        <div className="mt-2">Health: <StatusBadge status={placement.health} /> <span className="text-xs text-inksoft">Last checked {fmtDateTime(placement.last_checked_at)}</span></div></section>}

      {dispute && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-2">Issue raised on this order <StatusBadge status={dispute.status} /></h2>
          <p className="text-sm whitespace-pre-line">{dispute.reason}</p>
          {dispute.resolution && <p className="text-sm mt-3 border-t border-line pt-3"><b>Resolution:</b> {dispute.resolution}</p>}
          <ul className="mt-4 grid gap-2 text-sm">{(dMsgs ?? []).map((m: any, i: number) => <li key={i} className="border border-line rounded p-2.5"><div className="text-xs text-inksoft">{m.sender_role === "publisher" ? "You" : m.sender_role === "admin" ? "PostAtlas team" : "Customer"} · {fmtDateTime(m.created_at)}</div><div className="whitespace-pre-line">{m.body}</div></li>)}</ul>
          {["OPEN", "UNDER_REVIEW"].includes(dispute.status) && <form action={addDisputeMessage} className="mt-4 grid gap-2"><input type="hidden" name="dispute_id" value={dispute.id} /><label className="label" htmlFor="dm">Your response</label><textarea id="dm" name="body" required minLength={2} maxLength={2000} rows={3} className="input" /><button className="btn w-fit">Send response</button></form>}
        </section>
      )}
    </div>
  );
}
