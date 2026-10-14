import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminSetOrderStatus, adminManualVerify } from "@/lib/actions/fulfillment";
import { reviewSubmission } from "@/lib/actions/submissions";
import { resolveDispute, addDisputeMessage } from "@/lib/actions/disputes";
import { PageHeader, Money, fmtDateTime } from "@/components/ui";
import { formatAmount, formatUsd } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { FormFeedback } from "@/components/FormFeedback";
import { ORDER_STATUS_LABEL, allowedTransitions } from "@/lib/order-state";
import { describeFlags } from "@/lib/content-policy";
import { isUuid } from "@/lib/validation";
import type { OrderStatus } from "@/lib/types";

export const metadata = { title: "Order" };

export default async function AdminOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  await requireAdmin();
  const db = createAdminClient();
  const { data: order } = await db.from("orders").select("*, organizations(name), publisher_websites(domain, publisher_profiles(display_name))").eq("id", id).maybeSingle();
  if (!order) notFound();
  const status = order.status as OrderStatus;
  const [pricingRes, payoutsRes, refundsRes, casesRes] = await Promise.all([
    db.from("order_pricing").select("list_price_usd, commission_bps, commission_usd, publisher_net_usd, checkout_currency, amount_due, fx_rate, fx_source").eq("order_id", id).maybeSingle(),
    db.from("publisher_payouts").select("kind, amount, status").eq("order_id", id).order("created_at"),
    db.from("refunds").select("amount, currency, status").eq("order_id", id).order("created_at"),
    db.from("recovery_cases").select("kind, status").eq("order_id", id).order("created_at")
  ]);
  const finance = { pricing: pricingRes.data as any, payouts: (payoutsRes.data ?? []) as any[], refunds: (refundsRes.data ?? []) as any[], cases: (casesRes.data ?? []) as any[] };
  const [events, sub, placement, payments, dispute] = await Promise.all([
    db.from("order_events").select("created_at, actor_role, to_status, note, event_type").eq("order_id", id).order("created_at").limit(200),
    db.from("content_submissions").select("*").eq("order_id", id).maybeSingle(),
    db.from("published_placements").select("id, published_url, health, last_checked_at, consecutive_failures").eq("order_id", id).maybeSingle(),
    db.from("payments").select("id, status, amount, submitted_at, transaction_reference").eq("order_id", id).order("submitted_at", { ascending: false }),
    db.from("disputes").select("*").eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const { data: checks } = placement.data ? await db.from("backlink_checks").select("checked_at, result, message, trigger").eq("placement_id", placement.data.id).order("checked_at", { ascending: false }).limit(10) : { data: [] as any[] };
  const { data: dMsgs } = dispute.data ? await db.from("dispute_messages").select("sender_role, body, created_at").eq("dispute_id", dispute.data.id).order("created_at") : { data: [] as any[] };
  const org = Array.isArray(order.organizations) ? order.organizations[0] : order.organizations;
  const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;
  const adminTargets = allowedTransitions(status, "admin").filter((s) => ["CANCELLED", "COMPLETED", "IN_PROGRESS", "MONITORING"].includes(s));
  const flags = (sub.data?.policy_flags ?? []) as { category: any }[];
  const dOpen = dispute.data && ["OPEN", "UNDER_REVIEW"].includes(dispute.data.status);

  return (
    <div>
      <PageHeader title={`${org?.name} to ${site?.domain}`} subtitle={`${order.order_type} · ${order.target_url}`} action={<StatusBadge status={status} />} />
      <FormFeedback error={sp.error} />
      <div className="card mb-6 text-sm grid sm:grid-cols-4 gap-4"><div><div className="text-xs text-inksoft">Price</div><Money value={order.customer_price} /></div><div><div className="text-xs text-inksoft">Anchor</div>{order.anchor_text ?? "-"}</div><div><div className="text-xs text-inksoft">Created</div>{fmtDateTime(order.created_at)}</div><div><div className="text-xs text-inksoft">Payments</div>{(payments.data ?? []).map((p: any) => <div key={p.id}><StatusBadge status={p.status} /></div>)}{(payments.data ?? []).length === 0 && "-"}</div></div>

      {status === "CONTENT_SUBMITTED" && sub.data && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-1">Article held for review</h2>
          {flags.length > 0 && <p className="text-sm text-redsig mb-2">Flagged: {describeFlags(flags)}</p>}
          <h3 className="font-medium">{sub.data.title}</h3><pre className="whitespace-pre-wrap break-words text-sm font-sans max-h-96 overflow-auto my-3">{sub.data.body}</pre>
          <div className="flex flex-wrap gap-3"><form action={reviewSubmission}><input type="hidden" name="order_id" value={id} /><input type="hidden" name="decision" value="approve" /><button className="btn-primary">Approve and send to publisher</button></form>
            <form action={reviewSubmission} className="flex gap-2 flex-wrap"><input type="hidden" name="order_id" value={id} /><input type="hidden" name="decision" value="request_changes" /><label className="sr-only" htmlFor="note">Requested changes</label><input id="note" name="note" required minLength={3} maxLength={1000} placeholder="What should the customer change?" className="input w-72" /><button className="btn">Request changes</button></form></div></section>
      )}
      {sub.data && status !== "CONTENT_SUBMITTED" && <details className="card mb-6"><summary className="cursor-pointer font-medium">Submitted article: {sub.data.title} ({sub.data.word_count} words)</summary><pre className="whitespace-pre-wrap break-words text-sm font-sans max-h-96 overflow-auto mt-3">{sub.data.body}</pre></details>}

      {placement.data && <section className="card mb-6 text-sm"><h2 className="font-serif font-semibold text-lg mb-2">Placement</h2><a className="underline break-all text-verdigrisdark" href={placement.data.published_url} target="_blank" rel="noopener noreferrer nofollow">{placement.data.published_url}</a>
        <div className="mt-2">Health <StatusBadge status={placement.data.health} /> · consecutive failures {placement.data.consecutive_failures} · last checked {fmtDateTime(placement.data.last_checked_at)}</div>
        <ul className="mt-3 border-t border-line pt-2">{(checks ?? []).map((c: any) => <li key={c.checked_at} className="flex justify-between gap-3 py-0.5"><span>{c.message ?? c.result} <span className="text-xs text-inksoft">({c.trigger})</span></span><span className="text-inksoft whitespace-nowrap">{fmtDateTime(c.checked_at)}</span></li>)}</ul>
        {status === "VERIFICATION_PENDING" && <form action={adminManualVerify} className="mt-4 flex flex-wrap gap-2"><input type="hidden" name="order_id" value={id} /><label className="sr-only" htmlFor="ev">Evidence</label><input id="ev" name="note" required minLength={10} maxLength={500} placeholder="Evidence you checked (required)" className="input w-80" /><button className="btn">Verify manually</button></form>}</section>}

      {dispute.data && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-2">Dispute <StatusBadge status={dispute.data.status} /></h2><div className="text-xs text-inksoft mb-1">{dispute.data.category}</div>
          <p className="text-sm whitespace-pre-line">{dispute.data.reason}</p>{dispute.data.evidence && <p className="text-sm text-inksoft whitespace-pre-line mt-2">Evidence: {dispute.data.evidence}</p>}
          <ul className="mt-3 grid gap-2 text-sm">{(dMsgs ?? []).map((m: any, i: number) => <li key={i} className="border border-line rounded p-2.5"><div className="text-xs text-inksoft">{m.sender_role} · {fmtDateTime(m.created_at)}</div><div className="whitespace-pre-line">{m.body}</div></li>)}</ul>
          {dispute.data.resolution && <p className="text-sm mt-3 border-t border-line pt-3"><b>Resolution:</b> {dispute.data.resolution}</p>}
          {dOpen && <>
            <form action={addDisputeMessage} className="mt-4 grid gap-2"><input type="hidden" name="dispute_id" value={dispute.data.id} /><label className="label" htmlFor="dm">Message to both parties</label><textarea id="dm" name="body" required minLength={2} maxLength={2000} rows={2} className="input" /><button className="btn w-fit">Send</button></form>
            <form action={resolveDispute} className="mt-5 grid gap-3 border-t border-line pt-4 max-w-lg"><input type="hidden" name="dispute_id" value={dispute.data.id} /><input type="hidden" name="order_id" value={id} />
              <div><label className="label" htmlFor="outcome">Outcome</label><select id="outcome" name="outcome" className="input"><option value="RESOLVED">Upheld (customer's issue was valid)</option><option value="REJECTED">Rejected (no fault found)</option></select></div>
              <div><label className="label" htmlFor="order_status">Order continues as</label><select id="order_status" name="order_status" className="input"><option value="MONITORING">Monitoring</option><option value="IN_PROGRESS">Publisher redoes the work</option><option value="REPLACEMENT_REQUESTED">Replacement</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>
              <div><label className="label" htmlFor="remedy">Financial remedy</label><select id="remedy" name="remedy" className="input"><option value="none">None: release any held payout</option><option value="release_payout">Release the held payout (publisher fulfilled)</option><option value="restoration">Publisher must restore the link (no extra pay)</option><option value="replacement">Arrange another publisher (keeps payout on hold)</option><option value="refund">Refund the customer (opens a refund request, nothing is sent yet)</option></select><p className="text-xs text-inksoft mt-1">Money already transferred to a publisher is never taken back automatically.</p></div>
              <div><label className="label" htmlFor="resolution">Resolution (sent to both parties)</label><textarea id="resolution" name="resolution" required minLength={10} maxLength={2000} rows={3} className="input" /></div>
              <button className="btn-primary w-fit">Resolve dispute</button></form></>}
        </section>)}

      <section className="card mb-6 text-sm" aria-labelledby="fin"><h2 id="fin" className="font-serif font-semibold text-lg mb-3">Money</h2>
        {finance.pricing ? <div className="grid sm:grid-cols-4 gap-3 mb-3">
          <div><div className="text-xs text-inksoft">List price (customer base)</div><b className="font-mono">{formatUsd(Number(finance.pricing.list_price_usd).toFixed(2))}</b></div>
          <div><div className="text-xs text-inksoft">PostAtlas commission ({finance.pricing.commission_bps / 100}%)</div><b className="font-mono">{formatUsd(Number(finance.pricing.commission_usd).toFixed(2))}</b></div>
          <div><div className="text-xs text-inksoft">Publisher entitlement</div><b className="font-mono">{formatUsd(Number(finance.pricing.publisher_net_usd).toFixed(2))}</b></div>
          <div><div className="text-xs text-inksoft">Customer pays</div><b className="font-mono">{formatAmount(finance.pricing.amount_due, finance.pricing.checkout_currency)}</b>{finance.pricing.checkout_currency === "PKR" ? <div className="text-xs text-inksoft">locked at {Number(finance.pricing.fx_rate).toFixed(2)} ({finance.pricing.fx_source})</div> : null}</div></div> : <p className="text-inksoft">No pricing snapshot.</p>}
        {finance.payouts.length > 0 && <div className="mb-2"><b>Payout obligations:</b> {finance.payouts.map((x: any) => `${x.kind} ${formatUsd(Number(x.amount).toFixed(2))} ${x.status}`).join(" · ")} · <Link className="underline" href="/admin/payouts">open payouts</Link></div>}
        {finance.refunds.length > 0 && <div className="mb-2"><b>Refunds:</b> {finance.refunds.map((x: any) => `${formatAmount(x.amount, x.currency)} ${x.status}`).join(" · ")} · <Link className="underline" href="/admin/refunds">open refunds</Link></div>}
        {finance.cases.length > 0 && <div><b>Recovery:</b> {finance.cases.map((x: any) => `${x.kind.replace("_", " ")} ${x.status}`).join(" · ")} · <Link className="underline" href="/admin/recovery">open recovery</Link></div>}
      </section>

      {adminTargets.length > 0 && !dOpen && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-3">Admin action</h2>
          <form action={adminSetOrderStatus} className="grid sm:grid-cols-[auto_1fr_auto] gap-3 items-end"><input type="hidden" name="order_id" value={id} />
            <div><label className="label" htmlFor="to">Move to</label><select id="to" name="to" className="input">{adminTargets.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}</select></div>
            <div><label className="label" htmlFor="why">Reason (logged)</label><input id="why" name="note" required minLength={5} maxLength={500} className="input" /></div><button className="btn">Apply</button></form></section>)}

      <h2 className="font-serif font-semibold text-lg mb-3">History</h2>
      <ol className="border-l-2 border-line pl-5 grid gap-3 text-sm">{(events.data ?? []).map((e: any, i: number) => <li key={i}><div className="font-medium">{e.to_status ? ORDER_STATUS_LABEL[e.to_status as OrderStatus] ?? e.to_status : e.event_type}</div><div className="text-xs text-inksoft">{fmtDateTime(e.created_at)} · {e.actor_role}{e.note ? ` · ${e.note}` : ""}</div></li>)}</ol>
      <p className="mt-6 text-sm"><Link className="underline" href="/admin/orders">Back to orders</Link></p>
    </div>
  );
}
