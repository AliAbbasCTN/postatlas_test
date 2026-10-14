"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf } from "@/lib/validation";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { transitionOrder, loadOrderFor, orderParties } from "@/lib/services/orders";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { canTransition } from "@/lib/order-state";
import { isAdminRole } from "@/lib/permissions";
import { DISPUTE_CATEGORIES } from "@/lib/dispute-categories";

const idOf = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^[0-9a-f-]{36}$/i.test(v) ? v : ""; };

// Only the customer side opens a dispute (about their own order).
export async function raiseDispute(formData: FormData) {
  const back = `/dashboard/orders/${idOf(formData, "order_id")}`;
  return withRedirect(back, async () => {
    const { user } = await actionSession();
    await rateLimit(`dispute:${user.id}`, LIMITS.dispute.window, LIMITS.dispute.max);
    const orderId = uuid(formData, "order_id");
    const category = oneOf(formData, "category", "Issue type", DISPUTE_CATEGORIES);
    const reason = text(formData, "reason", "Description", { min: 20, max: 2000, multiline: true });
    const evidence = text(formData, "evidence", "Evidence", { max: 2000, optional: true, multiline: true });
    const order = await loadOrderFor(orderId, { kind: "member", userId: user.id, cap: "manageOrders" });
    if (!order) throw new ActionError("Order not found.");
    if (!canTransition(order.status, "DISPUTED", "customer")) throw new ActionError("An issue cannot be raised at this stage of the order.");

    const db = createAdminClient();
    const { data: dispute, error } = await db.from("disputes").insert({ order_id: order.id, raised_by: user.id, category, reason, evidence: evidence || null }).select("id").single();
    if (error || !dispute) {
      if (error?.code === "23505") throw new ActionError("An issue is already open for this order.");
      console.error("[raiseDispute]", error?.message);
      throw new ActionError("Could not open the issue.");
    }
    await db.from("orders").update({ disputed_from: order.status }).eq("id", order.id);
    try { await transitionOrder(order.id, order.status, "DISPUTED", { id: user.id, role: "customer" }, `Issue raised: ${category}`); }
    catch (e) { await db.from("disputes").delete().eq("id", dispute.id); throw e; }

    // Money that has not been paid out yet is held while the dispute is open. Anything already transferred is NOT clawed back here.
    const held = await db.rpc("hold_payouts_for_order", { p_order: order.id, p_actor: user.id, p_kind: "dispute", p_reason: `Dispute opened: ${category}` });
    if (held.error) console.error("[raiseDispute] hold", held.error.message);
    await logAudit({ actorId: user.id, organizationId: order.organization_id, action: "dispute.opened", resourceType: "dispute", resourceId: dispute.id, metadata: { order_id: order.id, category } });
    const parties = await orderParties(order.id);
    if (parties?.publisherUserId) await notifyMany([parties.publisherUserId], "dispute.opened", { order_id: order.id }, { subject: "An issue was raised on an order", body: "Please review and respond so we can resolve it.", path: `/publisher/orders/${order.id}` });
    await notifyStaff("Dispute opened", `Order ${order.id}: ${category}`, "/admin/disputes");
    revalidatePath(back);
    redirect(`${back}?notice=${encodeURIComponent("Your issue was sent to our team.")}`);
  });
}

// Customer, the order's publisher, or an admin may add a message - each only to disputes on orders they belong to.
export async function addDisputeMessage(formData: FormData) {
  const fallback = "/dashboard/orders";
  return withRedirect(fallback, async () => {
    const session = await actionSession();
    const disputeId = uuid(formData, "dispute_id");
    const body = text(formData, "body", "Message", { min: 2, max: 2000, multiline: true });
    const db = createAdminClient();
    const { data: dispute } = await db.from("disputes").select("id, order_id, status").eq("id", disputeId).maybeSingle();
    if (!dispute || !["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw new ActionError("This issue is closed.");
    const parties = await orderParties(dispute.order_id);
    if (!parties) throw new ActionError("Issue not found.");

    let role: "customer" | "publisher" | "admin";
    let back: string;
    if (isAdminRole(session.platformRole)) { role = "admin"; back = `/admin/orders/${dispute.order_id}`; }
    else if (parties.publisherUserId === session.user.id && session.platformRole === "publisher") { role = "publisher"; back = `/publisher/orders/${dispute.order_id}`; }
    else if (session.workspaces.some((w) => w.id === parties.order.organization_id)) { role = "customer"; back = `/dashboard/orders/${dispute.order_id}`; }
    else throw new ActionError("Issue not found.");

    await db.from("dispute_messages").insert({ dispute_id: disputeId, sender_id: session.user.id, sender_role: role, body });
    if (role === "admin" && dispute.status === "OPEN") await db.from("disputes").update({ status: "UNDER_REVIEW" }).eq("id", disputeId).eq("status", "OPEN");
    const others = [...(role !== "customer" ? parties.customerUserIds : []), ...(role !== "publisher" && parties.publisherUserId ? [parties.publisherUserId] : [])].filter((u) => u !== session.user.id);
    await notifyMany(others, "dispute.message", { order_id: dispute.order_id }, { subject: "New message on an order issue", body: "There is a new message about an issue on your order.", path: role === "customer" || isAdminRole(session.platformRole) ? `/dashboard/orders/${dispute.order_id}` : `/publisher/orders/${dispute.order_id}` });
    if (role !== "admin") await notifyStaff("Dispute message", `New message on dispute ${disputeId}`, `/admin/orders/${dispute.order_id}`);
    revalidatePath(back);
    redirect(back);
  });
}

const RESOLVE_TO = ["MONITORING", "IN_PROGRESS", "REPLACEMENT_REQUESTED", "COMPLETED", "CANCELLED"] as const;

// Only an admin resolves. Neither party can touch the outcome.
export async function resolveDispute(formData: FormData) {
  const oid = idOf(formData, "order_id");
  const back = `/admin/orders/${oid}`;
  return withRedirect(back, async () => {
    const { user } = await actionAdmin();
    const disputeId = uuid(formData, "dispute_id");
    const outcome = oneOf(formData, "outcome", "Outcome", ["RESOLVED", "REJECTED"] as const);
    const to = oneOf(formData, "order_status", "Order status after resolution", RESOLVE_TO);
    const resolution = text(formData, "resolution", "Resolution", { min: 10, max: 2000, multiline: true });
    const remedy = oneOf(formData, "remedy", "Remedy", ["none", "restoration", "replacement", "refund", "release_payout"] as const);
    const db = createAdminClient();
    const { data: dispute } = await db.from("disputes").select("id, order_id, status").eq("id", disputeId).maybeSingle();
    if (!dispute || !["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw new ActionError("This issue is already closed.");
    const { data: closed } = await db.from("disputes").update({ status: outcome, resolution, resolved_by: user.id, resolution_status: to, remedy, resolved_at: new Date().toISOString() })
      .eq("id", disputeId).in("status", ["OPEN", "UNDER_REVIEW"]).select("id").maybeSingle();
    if (!closed) throw new ActionError("This issue was just closed by someone else.");
    await transitionOrder(dispute.order_id, "DISPUTED", to, { id: user.id, role: "admin" }, `Dispute ${outcome.toLowerCase()}: ${resolution}`);
    // Apply the recorded remedy. Each step is idempotent in the database, and a failure is reported, never swallowed.
    const remedyErrors: string[] = [];
    if (remedy === "refund") {
      const r = await db.rpc("request_refund", { p_order: dispute.order_id, p_amount: null, p_reason: `Dispute resolved in the customer's favour: ${resolution}`.slice(0, 900), p_actor: user.id, p_role: "admin", p_key: `dispute:${disputeId}` });
      if (r.error) remedyErrors.push("refund request");
    } else if (remedy === "restoration") {
      const r = await db.rpc("open_recovery_case", { p_order: dispute.order_id, p_kind: "link_restoration", p_reason: `Dispute: ${resolution}`.slice(0, 900), p_actor: user.id, p_deadline_hours: 72 });
      if (r.error) remedyErrors.push("restoration case");
    } else if (remedy === "none" || remedy === "release_payout") {
      const r = await db.rpc("release_payouts_for_order", { p_order: dispute.order_id, p_actor: user.id, p_kind: "dispute" });
      if (r.error) remedyErrors.push("payout release");
    }   // "replacement": the payout hold stays until an administrator completes the replacement in /admin/recovery
    if (remedyErrors.length) { console.error("[resolveDispute] remedy failed:", remedyErrors.join(", ")); await notifyStaff("A dispute remedy needs manual action", `Dispute ${disputeId} was resolved but this step failed: ${remedyErrors.join(", ")}.`, `/admin/orders/${dispute.order_id}`).catch(() => undefined); }
    await logAudit({ actorId: user.id, action: "dispute.resolved", resourceType: "dispute", resourceId: disputeId, metadata: { order_id: dispute.order_id, outcome, order_status: to, remedy } });
    const parties = await orderParties(dispute.order_id);
    if (parties) {
      await notifyMany(parties.customerUserIds, "dispute.resolved", { order_id: dispute.order_id }, { subject: "Your order issue was resolved", body: resolution, path: `/dashboard/orders/${dispute.order_id}` });
      if (parties.publisherUserId) await notifyMany([parties.publisherUserId], "dispute.resolved", { order_id: dispute.order_id }, { subject: "An order issue was resolved", body: resolution, path: `/publisher/orders/${dispute.order_id}` });
    }
    revalidatePath(back); revalidatePath("/admin/disputes");
    redirect(back);
  });
}
