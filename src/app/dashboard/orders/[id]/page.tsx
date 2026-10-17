import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelOrder, requestReplacement, resolveExpiredOrder } from "@/lib/actions/orders";
import { submitSiteReview } from "@/lib/actions/reviews";
import { DeadlineNotice } from "@/components/DeadlineNotice";
import { StarInput, StarsDisplay } from "@/components/Stars";
import { canRequestExpiryRemedy, closedOrderLabel, formatDueUtc } from "@/lib/order-deadline";
import { canReviewOrder, MAX_COMMENT } from "@/lib/review";
import { submitPayment } from "@/lib/actions/payments";
import { submitArticle } from "@/lib/actions/submissions";
import { recheckPlacement } from "@/lib/actions/fulfillment";
import { raiseDispute, addDisputeMessage } from "@/lib/actions/disputes";
import { DISPUTE_CATEGORIES } from "@/lib/dispute-categories";
import { SubmitButton } from "@/components/SubmitButton";
import { OrderProgress, PageHeader, Money, fmtDateTime, NextStep } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { FormFeedback } from "@/components/FormFeedback";
import { ORDER_STATUS_LABEL, canTransition, customerNextAction } from "@/lib/order-state";
import { isUuid } from "@/lib/validation";
import { orgCan } from "@/lib/permissions";
import { formatAmount, formatUsd } from "@/lib/money";
import { describeFlags } from "@/lib/content-policy";
import type { OrderStatus } from "@/lib/types";

export const metadata = { title: "Order" };
const CATEGORY_LABEL: Record<string, string> = { not_published: "Not published", wrong_url: "Wrong URL", link_missing: "Link missing", page_removed: "Page removed", wrong_attribute: "Wrong link attribute", requirements_not_followed: "Requirements not followed", publisher_failed: "Publisher failed to deliver", changed_after_publication: "Changed after publication", payment: "Payment", other: "Other" };

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; created?: string; notice?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const { workspaces } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data: order } = await supabase.from("orders").select("*, publisher_websites(domain, link_type, article_requirements, turnaround_days_max)").eq("id", id).maybeSingle();
  if (!order) notFound(); // RLS: other organisations' orders are simply not visible
  const status = order.status as OrderStatus;
  const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;

  const [events, submission, placement, dispute] = await Promise.all([
    supabase.from("order_events").select("created_at, actor_role, to_status, note, event_type").eq("order_id", id).order("created_at", { ascending: true }).limit(100),
    supabase.from("content_submissions").select("title, word_count, review_status, review_note, policy_flags, revision").eq("order_id", id).maybeSingle(),
    supabase.from("published_placements").select("id, published_url, health, last_checked_at, verified_at").eq("order_id", id).maybeSingle(),
    supabase.from("disputes").select("id, category, reason, status, resolution, created_at").eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const { data: checks } = placement.data ? await supabase.from("backlink_checks").select("checked_at, result, message, attribute").eq("placement_id", placement.data.id).order("checked_at", { ascending: false }).limit(5) : { data: [] as any[] };
  const { data: dMsgs } = dispute.data ? await supabase.from("dispute_messages").select("sender_role, body, created_at").eq("dispute_id", dispute.data.id).order("created_at").limit(100) : { data: [] as any[] };

  // Bank / wallet details are only loaded (server-side) while the customer actually needs them.
  // The payment method and amount were locked when the order was placed (order_pricing); nothing here is recalculated.
  const { data: pricing } = await supabase.from("order_pricing").select("list_price_usd, checkout_currency, amount_due, fx_rate, fx_source, fx_rate_at, payment_method_id").eq("order_id", id).maybeSingle();
  const methods = status === "PAYMENT_PENDING" && pricing?.payment_method_id ? (await createAdminClient().from("payment_methods").select("id, name, account_identifier, instructions").eq("id", pricing.payment_method_id)).data ?? [] : [];

  // Reviews and refunds have no browser-readable policy for the customer, so they are read here on the server, only after the
  // order itself was loaded through RLS (which proves the caller belongs to the owning workspace).
  const adminDb = createAdminClient();
  const [{ data: review }, { data: refund }] = await Promise.all([
    adminDb.from("site_reviews").select("rating, comment, status, created_at").eq("order_id", id).maybeSingle(),
    order.expiry_choice === "refund" ? adminDb.from("refunds").select("status, amount, currency, created_at").eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const next = customerNextAction(status);
  // The caller's role in the workspace that OWNS this order (their personal account or a team), not the active one.
  const ownerRole = workspaces.find((w) => w.id === order.organization_id)?.role;
  const canPay = orgCan(ownerRole, "manageOrders");
  const canSubmit = orgCan(ownerRole, "submitContent");
  const dispOpen = dispute.data && ["OPEN", "UNDER_REVIEW"].includes(dispute.data.status);
  const isGuest = order.order_type === "guest_post";
  const flags = (submission.data?.policy_flags ?? []) as { category: any }[];

  return (
    <div>
      <PageHeader title={`Order: ${site?.domain ?? "publisher"}`} subtitle={`${isGuest ? "Guest post" : "Link in an existing article"} · linking to ${order.target_url}`} action={<StatusBadge status={status} label={closedOrderLabel(status, order.expiry_choice) ?? undefined} />} />
      <FormFeedback error={sp.error} success={sp.created ? "Order created. Next, send payment and enter your reference below." : sp.notice} />
      {next && !["PAYMENT_PENDING", "PAID"].includes(status) && status !== "ISSUE_DETECTED" && <NextStep title={ORDER_STATUS_LABEL[status]} hint={next.hint} href="#history" label="See history" />}

      <OrderProgress status={status} />
      {status === "PUBLISHER_REJECTED" && order.expiry_choice ? (
        <section className="card mb-6 text-sm" aria-labelledby="expired-choice">
          <h2 id="expired-choice" className="font-serif font-semibold text-lg mb-1">{order.expiry_choice === "refund" ? "Refund requested" : "Alternative placement requested"}</h2>
          {order.expiry_choice === "refund"
            ? <p className="text-inksoft">The publisher missed the delivery deadline and you asked for a refund{refund ? <> of <b>{formatAmount(refund.amount, refund.currency)}</b> (status: <b>{refund.status.toLowerCase()}</b>)</> : ""}. Our team reviews it, then transfers the money manually and records the transfer here. Nothing is refunded until that happens, and this order closes once a full refund is completed.</p>
            : <p className="text-inksoft">The publisher missed the delivery deadline. Our team is arranging another publisher on the same price and terms, and will refund you if no suitable publisher is available. You will not be charged again.</p>}
        </section>
      ) : (status === "CANCELLED" || status === "PUBLISHER_REJECTED") && <p className="mb-6 rounded-md border border-line bg-white p-4 text-sm text-inksoft">{status === "CANCELLED" ? "This order was cancelled." : "The publisher declined this order."} You can choose another publisher from <Link className="text-accenttext underline" href="/dashboard/publishers">Find Publishers</Link>.</p>}

      <DeadlineNotice status={status} dueAt={order.due_at} turnaroundHours={order.turnaround_hours} viewer="customer" />
      {canRequestExpiryRemedy({ status, due_at: order.due_at }) && (canPay ? (
        <section id="expired" className="card mb-6 border-redsig/40" aria-labelledby="exp">
          <h2 id="exp" className="font-serif font-semibold text-lg mb-1">Choose what happens next</h2>
          <p className="text-sm text-inksoft mb-4">The publisher accepted this order but did not deliver by {formatDueUtc(order.due_at)}. You can wait a little longer (the publisher may still deliver), or choose one of the options below. Choosing closes the order for this publisher and they are not paid for it.</p>
          <form action={resolveExpiredOrder} className="grid gap-4 max-w-lg">
            <input type="hidden" name="order_id" value={order.id} />
            <div><label className="label" htmlFor="expiry_note">Note for our team (optional)</label><textarea id="expiry_note" name="note" maxLength={500} rows={2} className="input" /></div>
            <div className="flex flex-wrap gap-3">
              <SubmitButton name="choice" value="alternative" pendingText="Sending..." className="btn-primary">Find me another publisher</SubmitButton>
              <SubmitButton name="choice" value="refund" pendingText="Sending..." className="btn">Request a refund</SubmitButton>
            </div>
            <p className="text-xs text-inksoft">A refund follows our <Link className="underline text-accenttext" href="/refund-policy">Refund Policy</Link>: it is reviewed by our team and paid back manually to the method you used. Another publisher keeps the same price and your article; you are never charged twice.</p>
          </form>
        </section>
      ) : <p className="mb-6 rounded-md border border-line bg-white p-4 text-sm text-inksoft">This order is past its delivery deadline. The workspace owner or an SEO manager can ask for a refund or an alternative placement.</p>)}

      <div className="card mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div><div className="text-xs text-inksoft">Price</div><Money value={order.customer_price} />{pricing?.checkout_currency === "PKR" ? <div className="text-xs text-inksoft">Pay {formatAmount(pricing.amount_due, "PKR")}</div> : null}</div>
        <div><div className="text-xs text-inksoft">Link text</div>{order.anchor_text ?? "-"}</div>
        <div><div className="text-xs text-inksoft">Link type</div>{site?.link_type ?? "not stated"}</div>
        <div><div className="text-xs text-inksoft">Created</div>{fmtDateTime(order.created_at)}</div>
      </div>

      {status === "PAYMENT_PENDING" && canPay && (
        <section className="card mb-6" aria-labelledby="pay">
          <h2 id="pay" className="font-serif font-semibold text-lg mb-1">Pay for this order</h2>
          <p className="text-sm text-inksoft mb-4">Send <b className="font-mono">{pricing ? formatAmount(pricing.amount_due, pricing.checkout_currency) : <Money value={order.customer_price} />}</b>{pricing?.checkout_currency === "PKR" ? <> (locked at 1 USD = {Number(pricing.fx_rate).toFixed(2)} PKR, {pricing.fx_source}, {fmtDateTime(pricing.fx_rate_at)}; list price {formatUsd(pricing.list_price_usd)})</> : null} using the method below, then enter your payment reference. We review it manually. Nothing starts until your payment is approved.</p>
          {methods.length === 0 ? <p className="text-sm text-redsig mb-4">No payment method is available right now. Please <Link className="underline" href={`/dashboard/advice/new?order_id=${order.id}`}>contact us</Link>.</p> : (
            <ul className="mb-5 grid gap-3">{methods.map((m: any) => <li key={m.id} className="border border-line rounded p-3 text-sm"><b>{m.name}</b><div className="font-mono break-all">{m.account_identifier}</div>{m.instructions && <div className="text-inksoft whitespace-pre-line">{m.instructions}</div>}</li>)}</ul>
          )}
          <form action={submitPayment} className="grid gap-4 max-w-md">
            <input type="hidden" name="order_id" value={order.id} />
            <div><label className="label" htmlFor="transaction_reference">Payment reference</label><input id="transaction_reference" name="transaction_reference" required minLength={4} maxLength={100} className="input" /></div>
            <div><label className="label" htmlFor="note">Note (optional)</label><textarea id="note" name="note" maxLength={500} rows={2} className="input" /></div>
            <SubmitButton pendingText="Submitting..." className="btn-primary w-fit">Submit payment details</SubmitButton>
          </form>
          <form action={cancelOrder} className="mt-4"><input type="hidden" name="order_id" value={order.id} /><button className="text-sm text-inksoft underline">Cancel this order</button></form>
        </section>
      )}

      {status === "PAID" && canSubmit && (
        <section className="card mb-6" aria-labelledby="art">
          <h2 id="art" className="font-serif font-semibold text-lg mb-1">{isGuest ? "Submit your article" : "Tell the publisher where to add your link"}</h2>
          <p className="text-sm text-inksoft mb-4">Payment approved. {isGuest ? "Write plain text (at least 300 words)." : "Describe the page and the sentence the link should sit in."} Prohibited topics (gambling, CBD, vape, link networks) are not accepted.</p>
          {submission.data?.review_status === "CHANGES_REQUESTED" && <FormFeedback error={`Our team asked for changes: ${submission.data.review_note ?? ""}`} />}
          {site?.article_requirements && <div className="text-sm border border-line rounded p-3 mb-4 bg-mist"><b>Publisher requirements</b><div className="whitespace-pre-line">{site.article_requirements}</div></div>}
          <form action={submitArticle} className="grid gap-4">
            <input type="hidden" name="order_id" value={order.id} />
            <div><label className="label" htmlFor="title">{isGuest ? "Article title" : "Existing article or page"}</label><input id="title" name="title" required minLength={5} maxLength={200} className="input" /></div>
            <div><label className="label" htmlFor="body">{isGuest ? "Article text" : "Surrounding text (optional)"}</label><textarea id="body" name="body" rows={14} required={isGuest} maxLength={60000} className="input font-mono" /></div>
            <div><label className="label" htmlFor="instructions">Instructions for the publisher{isGuest ? " (optional)" : ""}</label><textarea id="instructions" name="instructions" rows={3} maxLength={2000} required={!isGuest} className="input" /></div>
            <p className="text-xs text-inksoft">The link will point to {order.target_url}{order.anchor_text ? ` with the text "${order.anchor_text}"` : ""}.</p>
            <SubmitButton pendingText="Sending..." className="btn-primary w-fit">Send to publisher</SubmitButton>
          </form>
        </section>
      )}

      {status === "CONTENT_SUBMITTED" && submission.data && (
        <div className="card mb-6 text-sm"><b>Your article is being reviewed by our team.</b>
          {flags.length > 0 && <p className="text-inksoft mt-1">It touches: {describeFlags(flags)}. We will email you with the outcome.</p>}</div>
      )}

      {placement.data && (
        <section className="card mb-6" aria-labelledby="health">
          <h2 id="health" className="font-serif font-semibold text-lg mb-3">Placement health</h2>
          <div className="text-sm grid gap-1">
            <div>Published page: <a className="underline break-all text-accenttext" href={placement.data.published_url} rel="noopener noreferrer nofollow" target="_blank">{placement.data.published_url}</a></div>
            <div>Status: <StatusBadge status={placement.data.health} /></div>
            <div>Last checked: {fmtDateTime(placement.data.last_checked_at)}</div>
            <div>Verified: {placement.data.verified_at ? fmtDateTime(placement.data.verified_at) : "Not yet verified"}</div>
          </div>
          {(checks ?? []).length > 0 && <ul className="mt-4 text-sm border-t border-line pt-3">{(checks ?? []).map((c: any) => <li key={c.checked_at} className="flex justify-between gap-3 py-1"><span>{c.message ?? c.result}</span><span className="text-inksoft whitespace-nowrap">{fmtDateTime(c.checked_at)}</span></li>)}</ul>}
          {["VERIFICATION_PENDING", "MONITORING", "ISSUE_DETECTED"].includes(status) && canPay && <form action={recheckPlacement} className="mt-4"><input type="hidden" name="order_id" value={order.id} /><button className="btn">Check the link now</button></form>}
        </section>
      )}

      {status === "ISSUE_DETECTED" && canPay && (
        <NextStep tone="attention" title="A problem was found with this placement" hint="You can ask for a replacement or raise an issue with our team." href="#issue" label="Review the issue" />
      )}
      {status === "ISSUE_DETECTED" && canPay && (
        <form action={requestReplacement} className="mb-6"><input type="hidden" name="order_id" value={order.id} /><button className="btn">Request a replacement</button></form>
      )}

      {(review || (canPay && canReviewOrder({ status, hasVerifiedPlacement: !!placement.data?.verified_at, alreadyReviewed: false }).ok)) && (
        <section id="review" className="card mb-6" aria-labelledby="rev">
          <h2 id="rev" className="font-serif font-semibold text-lg mb-1">Rate {site?.domain ?? "this website"}</h2>
          {review ? (
            <div className="text-sm"><StarsDisplay rating={review.rating} />{review.comment && <p className="mt-2 whitespace-pre-line">{review.comment}</p>}<p className="mt-2 text-xs text-inksoft">Reviewed {fmtDateTime(review.created_at)}{review.status === "hidden" ? " · hidden by our team" : " · shown on the website's listing"}. A review cannot be edited or repeated for the same order.</p></div>
          ) : (
            <form action={submitSiteReview} className="grid gap-4 max-w-lg">
              <p className="text-sm text-inksoft">Your placement was published and verified. Rate the website (not the publisher's profile) to help other buyers. Your name is never shown.</p>
              <input type="hidden" name="order_id" value={order.id} />
              <StarInput />
              <div><label className="label" htmlFor="comment">Feedback (optional)</label><textarea id="comment" name="comment" maxLength={MAX_COMMENT} rows={4} className="input" placeholder="How was the quality, speed and communication? Please leave out web addresses." /></div>
              <SubmitButton pendingText="Saving..." className="btn-primary w-fit">Submit review</SubmitButton>
            </form>
          )}
        </section>
      )}

      {dispute.data && (
        <section id="issue" className="card mb-6" aria-labelledby="dsp">
          <h2 id="dsp" className="font-serif font-semibold text-lg mb-2">Issue: {CATEGORY_LABEL[dispute.data.category] ?? dispute.data.category} <StatusBadge status={dispute.data.status} /></h2>
          <p className="text-sm whitespace-pre-line">{dispute.data.reason}</p>
          {dispute.data.resolution && <p className="text-sm mt-3 border-t border-line pt-3"><b>Resolution:</b> {dispute.data.resolution}</p>}
          <ul className="mt-4 grid gap-2 text-sm">{(dMsgs ?? []).map((m: any, i: number) => <li key={i} className="border border-line rounded p-2.5"><div className="text-xs text-inksoft">{m.sender_role === "customer" ? "You" : m.sender_role === "admin" ? "PostAtlas team" : "Publisher"} · {fmtDateTime(m.created_at)}</div><div className="whitespace-pre-line">{m.body}</div></li>)}</ul>
          {dispOpen && (
            <form action={addDisputeMessage} className="mt-4 grid gap-2"><input type="hidden" name="dispute_id" value={dispute.data.id} />
              <label className="label" htmlFor="dm">Add a message</label><textarea id="dm" name="body" required minLength={2} maxLength={2000} rows={3} className="input" /><button className="btn w-fit">Send</button></form>
          )}
        </section>
      )}

      {!dispOpen && canPay && canTransition(status, "DISPUTED", "customer") && (
        <details id={dispute.data ? undefined : "issue"} className="card mb-6">
          <summary className="cursor-pointer font-medium">Something wrong with this order? Raise an issue</summary>
          <form action={raiseDispute} className="grid gap-4 mt-4 max-w-lg">
            <input type="hidden" name="order_id" value={order.id} />
            <div><label className="label" htmlFor="category">What happened?</label><select id="category" name="category" required className="input">{DISPUTE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></div>
            <div><label className="label" htmlFor="reason">Describe the problem</label><textarea id="reason" name="reason" required minLength={20} maxLength={2000} rows={4} className="input" /></div>
            <div><label className="label" htmlFor="evidence">Evidence (links or details, optional)</label><textarea id="evidence" name="evidence" maxLength={2000} rows={2} className="input" /></div>
            <button className="btn-danger w-fit">Send issue to PostAtlas</button>
          </form>
        </details>
      )}

      <section id="history" aria-labelledby="hist" className="mb-6">
        <h2 id="hist" className="font-serif font-semibold text-lg mb-3">History</h2>
        <ol className="border-l-2 border-line pl-5 grid gap-3 text-sm">
          {(events.data ?? []).map((e: any, i: number) => (
            <li key={i}><div className="font-medium">{e.to_status ? ORDER_STATUS_LABEL[e.to_status as OrderStatus] ?? e.to_status : e.event_type}</div><div className="text-xs text-inksoft">{fmtDateTime(e.created_at)} · {e.actor_role === "system" ? "PostAtlas" : e.actor_role === "admin" ? "PostAtlas team" : e.actor_role === "publisher" ? "Publisher" : "You"}</div></li>
          ))}
        </ol>
      </section>
      <p className="text-sm text-inksoft">Questions before you decide anything? <Link className="underline text-accenttext" href={`/dashboard/advice/new?order_id=${order.id}`}>Ask for advice</Link></p>
    </div>
  );
}
