"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionPublisher, actionSession, actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf } from "@/lib/validation";
import { validatePublicHttpUrl } from "@/lib/url-safety";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { transitionOrder, loadOrderFor, orderParties } from "@/lib/services/orders";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { runPlacementCheck } from "@/lib/services/placements";
import { onPlacementVerified } from "@/lib/services/payouts";
import { openRejectionCase } from "@/lib/services/recovery";
import { canTransition } from "@/lib/order-state";
import { formatDueUtc, formatHours } from "@/lib/order-deadline";
import type { OrderStatus } from "@/lib/types";

const idOf = (fd: FormData) => { const v = String(fd.get("order_id") ?? ""); return /^[0-9a-f-]{36}$/i.test(v) ? v : ""; };

async function publisherOrder(formData: FormData) {
  const { user } = await actionPublisher();
  const id = uuid(formData, "order_id");
  const order = await loadOrderFor(id, { kind: "publisher", userId: user.id });
  if (!order) throw new ActionError("Order not found.");
  return { user, order };
}

export async function acceptOrder(formData: FormData) {
  const back = `/publisher/orders/${idOf(formData)}`;
  return withRedirect(back, async () => {
    const { user, order } = await publisherOrder(formData);
    await transitionOrder(order.id, order.status, "ACCEPTED", { id: user.id, role: "publisher" }, "Accepted by publisher");
    await logAudit({ actorId: user.id, action: "fulfillment.accepted", resourceType: "order", resourceId: order.id });
    const parties = await orderParties(order.id);
    // The database started the delivery clock inside the same transition; read the deadline it set.
    const { data: clock } = await createAdminClient().from("orders").select("due_at, turnaround_hours").eq("id", order.id).maybeSingle();
    const dueText = clock?.due_at ? formatDueUtc(clock.due_at) : null;
    if (parties) await notifyMany(parties.customerUserIds, "order.accepted", { order_id: order.id, due_at: clock?.due_at ?? null }, { subject: "The publisher accepted your order", body: dueText ? `Your placement is now in the publisher's queue. It is due by ${dueText} (${formatHours(clock!.turnaround_hours ?? 0)} from acceptance). If it is not delivered by then you can ask for a refund or an alternative placement.` : "Your placement is now in the publisher's queue.", path: `/dashboard/orders/${order.id}` });
    revalidatePath(back);
    redirect(dueText ? `${back}?notice=${encodeURIComponent(`Order accepted. Please deliver by ${dueText}.`)}` : back);
  });
}

export async function rejectOrder(formData: FormData) {
  const back = `/publisher/orders/${idOf(formData)}`;
  return withRedirect(back, async () => {
    const { user, order } = await publisherOrder(formData);
    const reason = text(formData, "reason", "Reason", { min: 10, max: 1000, multiline: true });
    await transitionOrder(order.id, order.status, "PUBLISHER_REJECTED", { id: user.id, role: "publisher" }, `Declined: ${reason}`);
    await logAudit({ actorId: user.id, action: "fulfillment.rejected", resourceType: "order", resourceId: order.id, metadata: { reason: reason.slice(0, 300) } });
    // The customer has already paid. The order enters a tracked recovery case (reassign to another publisher, or refund) and
    // the declining publisher earns nothing for it. If the order was never paid there is nothing to recover or refund.
    let recovery = false;
    try { recovery = (await openRejectionCase(order.id, reason, user.id)) !== null; } catch { recovery = false; }
    const parties = await orderParties(order.id);
    if (parties) await notifyMany(parties.customerUserIds, "order.rejected", { order_id: order.id }, { subject: "The publisher could not take your order", body: recovery ? "Your payment is safe and you will not be charged again. We are arranging another publisher on the same terms, or a refund if that is not possible." : "The publisher declined this order. No payment had been confirmed, so you have not been charged.", path: `/dashboard/orders/${order.id}` });
    await notifyStaff("Publisher declined an order", `Order ${order.id} was declined: ${reason}${recovery ? " The customer has paid: a recovery case was opened." : ""}`, recovery ? "/admin/recovery" : `/admin/orders/${order.id}`);
    revalidatePath(back);
    redirect(back);
  });
}

export async function startWork(formData: FormData) {
  const back = `/publisher/orders/${idOf(formData)}`;
  return withRedirect(back, async () => {
    const { user, order } = await publisherOrder(formData);
    await transitionOrder(order.id, order.status, "IN_PROGRESS", { id: user.id, role: "publisher" }, "Work started");
    revalidatePath(back);
    redirect(back);
  });
}

// The publisher submits the live URL. It must be on the publisher's own listed domain, then a REAL check runs.
export async function submitPublishedUrl(formData: FormData) {
  const back = `/publisher/orders/${idOf(formData)}`;
  return withRedirect(back, async () => {
    const { user, order } = await publisherOrder(formData);
    await rateLimit(`verify:${user.id}`, LIMITS.verify.window, LIMITS.verify.max);
    const raw = text(formData, "published_url", "Published URL", { max: 2048 });
    const check = validatePublicHttpUrl(raw);
    if (!check.ok) throw new ActionError(check.reason);
    const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;
    const host = check.url.hostname.toLowerCase().replace(/^www\./, "");
    const own = String(site?.domain ?? "").toLowerCase();
    if (!own || (host !== own && !host.endsWith(`.${own}`))) throw new ActionError(`The URL must be on your listed domain (${own}).`);
    if (check.url.pathname === "/" && !check.url.search) throw new ActionError("Please enter the address of the published page, not the homepage.");
    check.url.hash = "";

    const status = order.status as OrderStatus;
    // REPLACEMENT_REQUESTED: the customer asked for a replacement after a link was removed; the ORIGINAL publisher (the order still
    // belongs to their listing; publisherOrder() proved that) delivers it here.
    if (!["ACCEPTED", "IN_PROGRESS", "VERIFICATION_PENDING", "REPLACEMENT_REQUESTED"].includes(status)) throw new ActionError("This order is not ready for a published URL.");
    const isReplacement = status === "REPLACEMENT_REQUESTED";

    const db = createAdminClient();
    const { data: profile } = await db.from("publisher_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (!profile) throw new ActionError("Publisher profile not found.");
    const url = check.url.toString();
    const { data: previous } = isReplacement ? await db.from("published_placements").select("published_url").eq("order_id", order.id).maybeSingle() : { data: null };
    const { data: placement, error } = await db.from("published_placements").upsert(
      { order_id: order.id, published_url: url, submitted_by: profile.id, health: "PENDING", consecutive_failures: 0, verified_at: null, verified_by: null, next_check_at: null, updated_at: new Date().toISOString() },
      { onConflict: "order_id" }
    ).select("id").single();
    if (error || !placement) { console.error("[publishedUrl]", error?.message); throw new ActionError("Could not save the published URL."); }

    await transitionOrder(order.id, status, "PUBLISHED", { id: user.id, role: "publisher" }, isReplacement ? `Replacement URL submitted${previous?.published_url ? ` (previous page: ${previous.published_url})`.slice(0, 400) : ""}` : "Published URL submitted");
    await logAudit({ actorId: user.id, action: isReplacement ? "fulfillment.replacement_published" : "fulfillment.published", resourceType: "order", resourceId: order.id });
    if (isReplacement) {
      const parties = await orderParties(order.id);
      if (parties) await notifyMany(parties.customerUserIds, "order.replacement_submitted", { order_id: order.id }, { subject: "The publisher submitted your replacement", body: "We are checking that your link is on the new page. You will hear from us as soon as it is verified.", path: `/dashboard/orders/${order.id}` });
      await notifyStaff("Replacement submitted", `The publisher submitted a replacement URL for order ${order.id}; the automatic check is running.`, `/admin/orders/${order.id}`).catch(() => undefined);
    }
    const result = await runPlacementCheck(placement.id, "publisher_submit", user.id);
    revalidatePath(back);
    const msg = result?.status === "VERIFIED" ? (isReplacement ? "Replacement verified. Monitoring is active again." : "Link verified. Monitoring is now active.") : `Saved. Verification result: ${result?.message ?? "pending"}`;
    redirect(`${back}?notice=${encodeURIComponent(msg)}`);
  });
}

// The publisher says they have restored a missing link: run a real check now (the daily check would find it anyway).
export async function requestRestorationCheck(formData: FormData) {
  const back = `/publisher/orders/${idOf(formData)}`;
  return withRedirect(back, async () => {
    const { user, order } = await publisherOrder(formData);
    await rateLimit(`verify:${user.id}`, LIMITS.verify.window, LIMITS.verify.max);
    if (order.status !== "ISSUE_DETECTED") throw new ActionError("This order has no open link issue.");
    const db = createAdminClient();
    const { data: p } = await db.from("published_placements").select("id").eq("order_id", order.id).maybeSingle();
    if (!p) throw new ActionError("No published page is on record for this order.");
    const result = await runPlacementCheck(p.id, "publisher_submit", user.id);
    revalidatePath(back);
    redirect(`${back}?notice=${encodeURIComponent(result?.status === "VERIFIED" ? "The link is back. Thank you; the restoration request is closed." : `Check result: ${result?.message ?? "pending"}`)}`);
  });
}

// Customer (or admin) asks for a fresh real check.
export async function recheckPlacement(formData: FormData) {
  const id = idOf(formData);
  return withRedirect(`/dashboard/orders/${id}`, async () => {
    const { user } = await actionSession();
    await rateLimit(`verify:${user.id}`, LIMITS.verify.window, LIMITS.verify.max);
    const orderId = uuid(formData, "order_id");
    const order = await loadOrderFor(orderId, { kind: "member", userId: user.id, cap: "manageOrders" });
    if (!order) throw new ActionError("Order not found.");
    if (!["VERIFICATION_PENDING", "MONITORING", "ISSUE_DETECTED"].includes(order.status)) throw new ActionError("There is nothing to check yet.");
    const db = createAdminClient();
    const { data: p } = await db.from("published_placements").select("id").eq("order_id", order.id).maybeSingle();
    if (!p) throw new ActionError("No published page has been submitted yet.");
    const result = await runPlacementCheck(p.id, "customer_request", user.id);
    revalidatePath(`/dashboard/orders/${order.id}`);
    redirect(`/dashboard/orders/${order.id}?notice=${encodeURIComponent(result ? result.message : "Check complete.")}`);
  });
}

// ---- admin order controls ------------------------------------------------------
const ADMIN_TARGETS = ["CANCELLED", "COMPLETED", "IN_PROGRESS", "MONITORING"] as const;

export async function adminSetOrderStatus(formData: FormData) {
  const id = idOf(formData);
  const back = `/admin/orders/${id}`;
  return withRedirect(back, async () => {
    const { user } = await actionAdmin();
    const orderId = uuid(formData, "order_id");
    const to = oneOf(formData, "to", "Status", ADMIN_TARGETS);
    const note = text(formData, "note", "Reason", { min: 5, max: 500, multiline: true });
    const order = await loadOrderFor(orderId, { kind: "admin" });
    if (!order) throw new ActionError("Order not found.");
    if (!canTransition(order.status, to, "admin")) throw new ActionError("That change is not allowed from the order's current state.");
    await transitionOrder(order.id, order.status, to, { id: user.id, role: "admin" }, note);
    // Cancelling a PAID order does not refund it. If money was confirmed, a refund REQUEST is opened for the refund
    // workflow (approve -> transfer -> confirmation); the order is never shown as refunded until that completes.
    if (to === "CANCELLED") {
      const { data: paid } = await createAdminClient().from("payments").select("id").eq("order_id", order.id).eq("status", "PAID").maybeSingle();
      if (paid) await createAdminClient().rpc("request_refund", { p_order: order.id, p_amount: null, p_reason: `Order cancelled by admin: ${note}`.slice(0, 900), p_actor: user.id, p_role: "admin", p_key: `cancel:${order.id}` });
      await createAdminClient().rpc("cancel_unpaid_payouts", { p_order: order.id, p_actor: user.id, p_reason: "Order cancelled" });
    }
    await logAudit({ actorId: user.id, action: "order.admin_status", resourceType: "order", resourceId: order.id, metadata: { from: order.status, to } });
    revalidatePath(back);
    redirect(back);
  });
}

// Manual verification is the exception path (e.g. a site that blocks our checker). A reason is mandatory and it is logged.
export async function adminManualVerify(formData: FormData) {
  const id = idOf(formData);
  const back = `/admin/orders/${id}`;
  return withRedirect(back, async () => {
    const { user } = await actionAdmin();
    const orderId = uuid(formData, "order_id");
    const note = text(formData, "note", "Evidence", { min: 10, max: 500, multiline: true });
    const order = await loadOrderFor(orderId, { kind: "admin" });
    if (!order || order.status !== "VERIFICATION_PENDING") throw new ActionError("This order is not waiting for verification.");
    const db = createAdminClient();
    const { data: p } = await db.from("published_placements").select("id").eq("order_id", orderId).maybeSingle();
    if (!p) throw new ActionError("No published page has been submitted.");
    const now = new Date().toISOString();
    await transitionOrder(orderId, "VERIFICATION_PENDING", "VERIFIED", { id: user.id, role: "admin" }, `Manually verified: ${note}`);
    await transitionOrder(orderId, "VERIFIED", "MONITORING", { id: null, role: "system" }, "Monitoring started");
    await db.from("published_placements").update({ health: "HEALTHY", verified_at: now, verified_by: user.id, last_checked_at: now, next_check_at: new Date(Date.now() + 24 * 3600_000).toISOString(), updated_at: now }).eq("id", p.id);
    await logAudit({ actorId: user.id, action: "placement.manually_verified", resourceType: "order", resourceId: orderId });
    await onPlacementVerified(orderId, now);
    revalidatePath(back);
    redirect(back);
  });
}
