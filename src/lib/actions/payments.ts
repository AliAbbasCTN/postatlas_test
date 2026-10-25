"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf } from "@/lib/validation";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { loadOrderFor, orderParties } from "@/lib/services/orders";
import { notifyMany, notifyStaff } from "@/lib/services/notify";

// Customer reports a manual payment. The amount is read from the order, never from the form.
export async function submitPayment(formData: FormData) {
  const raw = String(formData.get("order_id") ?? "");
  const back = `/dashboard/orders/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`;
  return withRedirect(back, async () => {
    const { user } = await actionSession();
    await rateLimit(`payment:${user.id}`, LIMITS.payment.window, LIMITS.payment.max);
    const orderId = uuid(formData, "order_id");
    const reference = text(formData, "transaction_reference", "Payment reference", { min: 4, max: 100 });
    const note = text(formData, "note", "Note", { max: 500, optional: true, multiline: true });

    const order = await loadOrderFor(orderId, { kind: "member", userId: user.id, cap: "manageOrders" });
    if (!order) throw new ActionError("Order not found.");
    if (order.status !== "PAYMENT_PENDING") throw new ActionError("This order is not waiting for payment details.");

    const db = createAdminClient();
    // One transaction in Postgres: payment row (amount/currency/method taken from the locked checkout snapshot) + order
    // transition. A duplicate reference or a changed order rolls both back, so there is no half-submitted state.
    const { data: paymentId, error } = await db.rpc("submit_payment", { p_order: order.id, p_actor: user.id, p_reference: reference, p_note: note || null });
    if (error || typeof paymentId !== "string") {
      if (error?.code === "23505") throw new ActionError("That payment reference has already been submitted.");
      console.error("[submitPayment]", error?.message);
      throw new ActionError("Could not submit your payment details. Please check the order is still waiting for payment and try again.");
    }
    const payment = { id: paymentId };
    // The reference itself is deliberately not written to the audit log.
    await logAudit({ actorId: user.id, organizationId: order.organization_id, action: "payment.submitted", resourceType: "payment", resourceId: payment.id, metadata: { order_id: order.id } });
    await notifyStaff("Payment submitted for review", `A customer submitted payment details for order ${order.id}.`, "/admin/payments");
    revalidatePath(back);
    redirect(`${back}?notice=${encodeURIComponent("Payment details received. We will review them shortly.")}`);
  });
}

// Admin approves or rejects. Compare-and-set on the payment row means two admins cannot both decide.
export async function reviewPayment(formData: FormData) {
  return withRedirect("/admin/payments", async () => {
    const { user } = await actionAdmin();
    const paymentId = uuid(formData, "payment_id");
    const decision = oneOf(formData, "decision", "Decision", ["approve", "reject"] as const);
    const reason = text(formData, "reason", "Reason", { max: 500, optional: decision === "approve", multiline: true });

    const db = createAdminClient();
    // Atomic: locks the order then the payment, so two admins (or a cancellation) cannot both decide, and the payment,
    // the order status, the ledger and the history are written together or not at all.
    const { data: result, error } = await db.rpc("review_payment", { p_payment: paymentId, p_admin: user.id, p_decision: decision, p_reason: reason || null });
    if (error || !result) {
      const msg = error?.message ?? "";
      if (/already been reviewed|no longer waiting/i.test(msg)) throw new ActionError("This payment was already reviewed, or its order is no longer waiting for review.");
      console.error("[reviewPayment]", msg);
      throw new ActionError("Could not record the decision. Nothing was changed.");
    }
    const payment = { order_id: (result as { order_id: string }).order_id };
    await logAudit({ actorId: user.id, action: decision === "approve" ? "payment.approved" : "payment.rejected", resourceType: "payment", resourceId: paymentId, metadata: { order_id: payment.order_id } });

    const parties = await orderParties(payment.order_id);
    if (parties) {
      await notifyMany(parties.customerUserIds, decision === "approve" ? "payment.approved" : "payment.rejected", { order_id: payment.order_id },
        decision === "approve"
          ? { subject: "Payment approved - submit your article", body: "Your payment was approved. The next step is to submit your article.", path: `/dashboard/orders/${payment.order_id}` }
          : { subject: "Your payment could not be confirmed", body: `We could not confirm your payment: ${reason}. You can submit the details again.`, path: `/dashboard/orders/${payment.order_id}` });
    }
    revalidatePath("/admin/payments");
    redirect(`/admin/payments?done=${decision}`);
  });
}
