"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { orderParties } from "@/lib/services/orders";
import { getUsdPkr, setManualUsdPkr } from "@/lib/services/fx";
import { validateManualRate } from "@/lib/fx";

// Every action here is administrator-only (actionAdmin), re-checked inside the database function as well, and each
// financial state change is a single locked database call so retries and double clicks cannot duplicate it.
const dbMessage = (m: string) => (/only an active administrator/.test(m) ? "You do not have permission to do that." : m.replace(/^.*?:\s*/, "").slice(0, 200));
function rpcFail(label: string, error: { message: string } | null): never {
  console.error(`[${label}]`, error?.message);
  throw new ActionError(error ? dbMessage(error.message) : "The action could not be completed.");
}

// ---- exchange rate -----------------------------------------------------------------------------------------------
export async function setManualRate(formData: FormData) {
  return withRedirect("/admin/finance", async () => {
    const { user } = await actionAdmin();
    await rateLimit(`fx-manual:${user.id}`, 3600, 10);
    const raw = text(formData, "rate", "Rate", { max: 20 });
    const note = text(formData, "note", "Source note", { min: 3, max: 60 });
    try { validateManualRate(raw); } catch { throw new ActionError("Enter a PKR-per-USD rate between 50 and 1000."); }
    await setManualUsdPkr(raw, user.id, note);
    await logAudit({ actorId: user.id, action: "fx.manual_rate", resourceType: "fx_rate", metadata: { rate: raw } });
    revalidatePath("/admin/finance");
    redirect("/admin/finance?done=rate");
  });
}

export async function refreshRateNow(_formData: FormData) {
  return withRedirect("/admin/finance", async () => {
    const { user } = await actionAdmin();
    await rateLimit(`fx-refresh:${user.id}`, 3600, 10);
    const { refreshUsdPkr } = await import("@/lib/services/fx");
    const r = await refreshUsdPkr();
    if (!r.ok) throw new ActionError(r.message);
    await getUsdPkr({ refresh: false });
    redirect("/admin/finance?done=refreshed");
  });
}

// ---- payout destinations ---------------------------------------------------------------------------------------------
export async function reviewDestination(formData: FormData) {
  return withRedirect("/admin/payouts", async () => {
    const { user } = await actionAdmin();
    const id = uuid(formData, "destination_id");
    const decision = oneOf(formData, "decision", "Decision", ["verify", "disable"] as const);
    const reason = text(formData, "reason", "Reason", { max: 300, optional: decision === "verify" });
    const db = createAdminClient();
    const patch = decision === "verify"
      ? { status: "VERIFIED", verified_by: user.id, verified_at: new Date().toISOString() }
      : { status: "DISABLED", disabled_reason: reason };
    const from = decision === "verify" ? "PENDING_VERIFICATION" : null;
    let q = db.from("payout_destinations").update(patch).eq("id", id);
    q = from ? q.eq("status", from) : q.neq("status", "DISABLED");
    const { data, error } = await q.select("id, publisher_id").maybeSingle();
    if (error || !data) throw new ActionError("That destination was already reviewed or no longer exists.");
    await logAudit({ actorId: user.id, action: `payout_destination.${decision}`, resourceType: "payout_destination", resourceId: id });
    const { data: pub } = await db.from("publisher_profiles").select("user_id").eq("id", data.publisher_id).maybeSingle();
    if (pub?.user_id) await notifyMany([pub.user_id], `payout_destination.${decision}`, { destination_id: id }, { subject: decision === "verify" ? "Your payout details were verified" : "Your payout details need attention", body: decision === "verify" ? "You can now receive payouts to this account." : "Your payout details were disabled. Please add new details.", path: "/publisher/payouts" });
    revalidatePath("/admin/payouts");
    redirect("/admin/payouts?done=destination");
  });
}

// ---- payout transfer records ---------------------------------------------------------------------------------------------
export async function recordPayout(formData: FormData) {
  return withRedirect("/admin/payouts", async () => {
    const { user } = await actionAdmin();
    await rateLimit(`payout-record:${user.id}`, 3600, 120);
    const payoutId = uuid(formData, "payout_id");
    const outcome = oneOf(formData, "outcome", "Outcome", ["paid", "failed", "uncertain"] as const);
    const reference = text(formData, "reference", "Transfer reference", { max: 120, optional: outcome !== "paid" });
    const evidence = text(formData, "evidence", "Evidence", { max: 1000, optional: outcome !== "paid", multiline: true });
    const errorNote = text(formData, "error_note", "Note", { max: 400, optional: true, multiline: true });
    const currency = oneOf(formData, "payout_currency", "Payout currency", ["USD", "PKR"] as const);
    const amount = text(formData, "payout_amount", "Amount sent", { max: 20, optional: outcome !== "paid" });
    const rate = text(formData, "fx_rate", "Exchange rate used", { max: 20, optional: true });
    const cost = text(formData, "conversion_cost", "Disclosed conversion cost", { max: 20, optional: true });
    if (outcome === "paid" && !/^\d{1,10}(\.\d{1,2})?$/.test(amount)) throw new ActionError("Enter the amount actually sent, for example 98.00.");
    const db = createAdminClient();
    let fxSource: string | null = null, fxAt: string | null = null;
    if (outcome === "paid" && currency === "PKR") {
      if (!rate) throw new ActionError("Enter the PKR-per-USD rate used for this transfer.");
      try { validateManualRate(rate); } catch { throw new ActionError("The exchange rate is not plausible."); }
      const stored = await getUsdPkr({ refresh: false });
      fxSource = stored ? `${stored.source} (reference)` : "entered by admin"; fxAt = new Date().toISOString();
    }
    const { data, error } = await db.rpc("record_payout_result", {
      p_payout: payoutId, p_admin: user.id, p_outcome: outcome, p_reference: reference || null, p_payout_currency: currency, p_payout_amount: amount ? Number(amount) : null,
      p_fx_rate: rate ? Number(rate) : null, p_fx_source: fxSource, p_fx_at: fxAt, p_conversion_cost: cost ? Number(cost) : 0, p_evidence: evidence || null, p_error: errorNote || null
    });
    if (error) rpcFail("recordPayout", error);
    await logAudit({ actorId: user.id, action: `payout.${String(data).toLowerCase()}`, resourceType: "payout", resourceId: payoutId });   // reference deliberately not logged
    const { data: p } = await db.from("publisher_payouts").select("publisher_id").eq("id", payoutId).maybeSingle();
    const { data: pub } = p ? await db.from("publisher_profiles").select("user_id").eq("id", p.publisher_id).maybeSingle() : { data: null };
    if (pub?.user_id && data === "PAID") await notifyMany([pub.user_id], "payout.paid", { payout_id: payoutId }, { subject: "Your payout was sent", body: "We sent your payout. It may take your bank some time to show it.", path: "/publisher/payouts" });
    if (pub?.user_id && data === "FAILED") await notifyMany([pub.user_id], "payout.failed", { payout_id: payoutId }, { subject: "A payout transfer failed", body: "The transfer did not go through. We will retry it; please check your payout details.", path: "/publisher/payouts" });
    revalidatePath("/admin/payouts");
    redirect("/admin/payouts?done=payout");
  });
}

export async function retryPayout(formData: FormData) {
  return withRedirect("/admin/payouts", async () => {
    const { user } = await actionAdmin();
    const { error } = await createAdminClient().rpc("retry_payout", { p_payout: uuid(formData, "payout_id"), p_admin: user.id });
    if (error) rpcFail("retryPayout", error);
    revalidatePath("/admin/payouts");
    redirect("/admin/payouts?done=retry");
  });
}

export async function holdOrReleasePayouts(formData: FormData) {
  return withRedirect("/admin/payouts", async () => {
    const { user } = await actionAdmin();
    const orderId = uuid(formData, "order_id");
    const op = oneOf(formData, "op", "Action", ["hold", "release"] as const);
    const db = createAdminClient();
    if (op === "hold") {
      const reason = text(formData, "reason", "Reason", { min: 5, max: 300 });
      const { error } = await db.rpc("hold_payouts_for_order", { p_order: orderId, p_actor: user.id, p_kind: "admin", p_reason: reason });
      if (error) rpcFail("hold", error);
    } else {
      for (const kind of ["admin", "dispute", "refund"] as const) {
        const { error } = await db.rpc("release_payouts_for_order", { p_order: orderId, p_actor: user.id, p_kind: kind });
        if (error) rpcFail("release", error);
      }
    }
    await logAudit({ actorId: user.id, action: `payout.${op}`, resourceType: "order", resourceId: orderId, metadata: op === "hold" ? { reason: text(formData, "reason", "Reason", { min: 5, max: 300 }) } : undefined });
    revalidatePath("/admin/payouts");
    redirect("/admin/payouts?done=" + op);
  });
}

/** Reject a payout entitlement that has NOT been sent (eligible, held or failed). Processing/paid payouts cannot be cancelled here. */
export async function cancelPayoutEntitlement(formData: FormData) {
  return withRedirect("/admin/payouts", async () => {
    const { user } = await actionAdmin();
    await rateLimit(`payout-cancel:${user.id}`, 3600, 30);
    const orderId = uuid(formData, "order_id");
    const reason = text(formData, "reason", "Reason", { min: 10, max: 300 });
    const { data, error } = await createAdminClient().rpc("cancel_unpaid_payouts", { p_order: orderId, p_actor: user.id, p_reason: reason });
    if (error) rpcFail("cancelPayout", error);
    if (!data) throw new ActionError("Nothing was cancelled: only eligible, held or failed payouts can be cancelled. Payouts being processed must be reconciled instead.");
    await logAudit({ actorId: user.id, action: "payout.cancelled", resourceType: "order", resourceId: orderId, metadata: { reason } });
    revalidatePath("/admin/payouts");
    redirect("/admin/payouts?done=cancelled");
  });
}

// ---- recovery ---------------------------------------------------------------------------------------------------------
export async function reassignOrder(formData: FormData) {
  return withRedirect("/admin/recovery", async () => {
    const { user } = await actionAdmin();
    const caseId = uuid(formData, "case_id");
    const listingId = uuid(formData, "listing_id", "Replacement publisher");
    const note = text(formData, "note", "Note", { max: 500, optional: true, multiline: true });
    const db = createAdminClient();
    const { data: c } = await db.from("recovery_cases").select("order_id").eq("id", caseId).maybeSingle();
    if (!c) throw new ActionError("Recovery case not found.");
    const { error } = await db.rpc("reassign_order", { p_order: c.order_id, p_case: caseId, p_new_listing: listingId, p_admin: user.id, p_note: note || null });
    if (error) rpcFail("reassignOrder", error);
    await logAudit({ actorId: user.id, action: "recovery.reassigned", resourceType: "order", resourceId: c.order_id });
    const parties = await orderParties(c.order_id);
    if (parties) await notifyMany(parties.customerUserIds, "order.reassigned", { order_id: c.order_id }, { subject: "Your order was given to another publisher", body: "Same price and same terms: you will not be charged more. We will tell you when the new publisher responds.", path: `/dashboard/orders/${c.order_id}` });
    if (parties?.publisherUserId) await notifyMany([parties.publisherUserId], "order.assigned", { order_id: c.order_id }, { subject: "You have a new order", body: "Please accept or decline it.", path: `/publisher/orders/${c.order_id}` });
    revalidatePath("/admin/recovery");
    redirect("/admin/recovery?done=reassigned");
  });
}

export async function resolveRecovery(formData: FormData) {
  return withRedirect("/admin/recovery", async () => {
    const { user } = await actionAdmin();
    const caseId = uuid(formData, "case_id");
    const outcome = oneOf(formData, "outcome", "Outcome", ["refund", "other", "cancel"] as const);
    const resolution = text(formData, "resolution", "Resolution", { min: 5, max: 500, multiline: true });
    const db = createAdminClient();
    const { data: c } = await db.from("recovery_cases").select("order_id").eq("id", caseId).maybeSingle();
    if (!c) throw new ActionError("Recovery case not found.");
    if (outcome === "refund") {
      const { error: rErr } = await db.rpc("request_refund", { p_order: c.order_id, p_amount: null, p_reason: `Recovery: ${resolution}`.slice(0, 900), p_actor: user.id, p_role: "admin", p_key: `case:${caseId}` });
      if (rErr) rpcFail("resolveRecovery.refund", rErr);
    }
    const { error } = await db.rpc("resolve_recovery_case", { p_case: caseId, p_admin: user.id, p_status: outcome === "refund" ? "RESOLVED_REFUND" : outcome === "cancel" ? "CANCELLED" : "RESOLVED_OTHER", p_resolution: resolution });
    if (error) rpcFail("resolveRecovery", error);
    await logAudit({ actorId: user.id, action: "recovery.resolved", resourceType: "order", resourceId: c.order_id, metadata: { outcome } });
    revalidatePath("/admin/recovery");
    redirect("/admin/recovery?done=resolved");
  });
}

// ---- refunds ----------------------------------------------------------------------------------------------------------
export async function requestRefundAction(formData: FormData) {
  const orderId = String(formData.get("order_id") ?? "");
  return withRedirect("/admin/refunds", async () => {
    const { user } = await actionAdmin();
    const oid = uuid(formData, "order_id");
    const reason = text(formData, "reason", "Reason", { min: 5, max: 900, multiline: true });
    const amt = text(formData, "amount", "Amount", { max: 14, optional: true });
    if (amt && !/^\d{1,10}(\.\d{1,2})?$/.test(amt)) throw new ActionError("Enter a valid amount, or leave it empty for the full amount paid.");
    const { error } = await createAdminClient().rpc("request_refund", { p_order: oid, p_amount: amt ? Number(amt) : null, p_reason: reason, p_actor: user.id, p_role: "admin", p_key: null });
    if (error) rpcFail("requestRefund", error);
    await logAudit({ actorId: user.id, action: "refund.requested", resourceType: "order", resourceId: oid });
    void orderId;
    redirect("/admin/refunds?done=requested");
  });
}

export async function advanceRefund(formData: FormData) {
  return withRedirect("/admin/refunds", async () => {
    const { user } = await actionAdmin();
    const id = uuid(formData, "refund_id");
    const act = oneOf(formData, "action", "Action", ["approve", "reject", "start", "retry"] as const);
    const note = text(formData, "note", "Note", { max: 500, optional: act !== "reject", multiline: true });
    const { data, error } = await createAdminClient().rpc("advance_refund", { p_refund: id, p_admin: user.id, p_action: act, p_note: note || null });
    if (error) rpcFail("advanceRefund", error);
    await logAudit({ actorId: user.id, action: `refund.${String(data).toLowerCase()}`, resourceType: "refund", resourceId: id });
    revalidatePath("/admin/refunds");
    redirect("/admin/refunds?done=" + act);
  });
}

export async function recordRefund(formData: FormData) {
  return withRedirect("/admin/refunds", async () => {
    const { user } = await actionAdmin();
    await rateLimit(`refund-record:${user.id}`, 3600, 120);
    const id = uuid(formData, "refund_id");
    const outcome = oneOf(formData, "outcome", "Outcome", ["completed", "failed", "uncertain"] as const);
    const reference = text(formData, "reference", "Transfer reference", { max: 120, optional: outcome !== "completed" });
    const evidence = text(formData, "evidence", "Evidence", { max: 1000, optional: outcome !== "completed", multiline: true });
    const errorNote = text(formData, "error_note", "Note", { max: 400, optional: true, multiline: true });
    const db = createAdminClient();
    const { data, error } = await db.rpc("record_refund_result", { p_refund: id, p_admin: user.id, p_outcome: outcome, p_reference: reference || null, p_evidence: evidence || null, p_error: errorNote || null });
    if (error) rpcFail("recordRefund", error);
    await logAudit({ actorId: user.id, action: `refund.${String(data).toLowerCase()}`, resourceType: "refund", resourceId: id });
    if (data === "COMPLETED") {
      const { data: r } = await db.from("refunds").select("order_id").eq("id", id).maybeSingle();
      const parties = r ? await orderParties(r.order_id) : null;
      if (parties) await notifyMany(parties.customerUserIds, "refund.completed", { refund_id: id }, { subject: "Your refund was sent", body: "We have sent your refund. It may take your bank some time to show it.", path: `/dashboard/orders/${r!.order_id}` });
    }
    if (data === "FAILED" || data === "UNCERTAIN") await notifyStaff("A refund needs attention", `Refund ${id} is ${data}.`, "/admin/refunds");
    revalidatePath("/admin/refunds");
    redirect("/admin/refunds?done=recorded");
  });
}

