"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf, countWords, containsActiveMarkup, ValidationError } from "@/lib/validation";
import { scanContentPolicy, describeFlags } from "@/lib/content-policy";
import { transitionOrder, loadOrderFor, orderParties } from "@/lib/services/orders";
import { notifyMany, notifyStaff } from "@/lib/services/notify";

const MIN_WORDS_GUEST_POST = 300;
const MAX_WORDS = 5000;

export async function submitArticle(formData: FormData) {
  const raw = String(formData.get("order_id") ?? "");
  const back = `/dashboard/orders/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`;
  return withRedirect(back, async () => {
    const { user } = await actionSession();
    const orderId = uuid(formData, "order_id");
    const order = await loadOrderFor(orderId, { kind: "member", userId: user.id, cap: "submitContent" });
    if (!order) throw new ActionError("Order not found.");
    if (order.status !== "PAID") throw new ActionError("This order is not ready for an article yet.");

    const isGuest = order.order_type === "guest_post";
    const title = text(formData, "title", isGuest ? "Article title" : "Where to place the link", { min: 5, max: 200 });
    const body = text(formData, "body", isGuest ? "Article" : "Surrounding text", { min: isGuest ? 1 : 1, max: 60_000, multiline: true, optional: !isGuest });
    const instructions = text(formData, "instructions", "Instructions for the publisher", { max: 2000, optional: !!isGuest, multiline: true, min: isGuest ? 1 : 10 });
    const words = countWords(body);
    if (isGuest && words < MIN_WORDS_GUEST_POST) throw new ValidationError(`The article needs at least ${MIN_WORDS_GUEST_POST} words (yours has ${words}).`);
    if (words > MAX_WORDS) throw new ValidationError(`The article can have at most ${MAX_WORDS} words.`);
    if ([title, body, instructions].some(containsActiveMarkup)) throw new ValidationError("Scripts and active HTML are not allowed. Please submit plain text.");

    const flags = scanContentPolicy(title, body, instructions);
    const db = createAdminClient();
    const { data: existing } = await db.from("content_submissions").select("id, revision").eq("order_id", order.id).maybeSingle();
    const row = {
      order_id: order.id, submitted_by: user.id, title, body: body || null, target_url: order.target_url, anchor_text: order.anchor_text,
      instructions: instructions || null, word_count: words, policy_flags: flags,
      review_status: flags.length ? "HELD" : "AUTO_CLEARED", review_note: null, updated_at: new Date().toISOString()
    };
    const { error } = existing
      ? await db.from("content_submissions").update({ ...row, revision: (existing.revision ?? 1) + 1 }).eq("id", existing.id)
      : await db.from("content_submissions").insert(row);
    if (error) { console.error("[submitArticle]", error.message); throw new ActionError("Could not save your article."); }

    await transitionOrder(order.id, "PAID", "CONTENT_SUBMITTED", { id: user.id, role: "customer" }, "Article submitted");
    await logAudit({ actorId: user.id, organizationId: order.organization_id, action: "article.submitted", resourceType: "order", resourceId: order.id, metadata: { words, flagged: flags.length > 0 } });

    if (flags.length) {
      await notifyStaff("Article held for review", `Order ${order.id}: flagged for ${describeFlags(flags)}.`, `/admin/orders/${order.id}`);
      revalidatePath(back);
      redirect(`${back}?notice=${encodeURIComponent(`Your article is being reviewed by our team (it touches: ${describeFlags(flags)}). We will email you with the outcome.`)}`);
    }
    await transitionOrder(order.id, "CONTENT_SUBMITTED", "PENDING_PUBLISHER", { id: null, role: "system" }, "Content policy check passed");
    const parties = await orderParties(order.id);
    if (parties?.publisherUserId) {
      await notifyMany([parties.publisherUserId], "order.new", { order_id: order.id },
        { subject: "New placement order", body: "A new order is ready for your review.", path: `/publisher/orders/${order.id}` });
    }
    revalidatePath(back);
    redirect(`${back}?notice=${encodeURIComponent("Article sent to the publisher.")}`);
  });
}

// Admin decision on a held article.
export async function reviewSubmission(formData: FormData) {
  const raw = String(formData.get("order_id") ?? "");
  const back = `/admin/orders/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`;
  return withRedirect(back, async () => {
    const { user } = await actionAdmin();
    const orderId = uuid(formData, "order_id");
    const decision = oneOf(formData, "decision", "Decision", ["approve", "request_changes"] as const);
    const note = text(formData, "note", "Note", { max: 1000, optional: decision === "approve", multiline: true });
    const db = createAdminClient();
    const parties = await orderParties(orderId);
    if (!parties || parties.order.status !== "CONTENT_SUBMITTED") throw new ActionError("This article is not waiting for review.");

    if (decision === "approve") {
      await db.from("content_submissions").update({ review_status: "APPROVED", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: note || null }).eq("order_id", orderId);
      await transitionOrder(orderId, "CONTENT_SUBMITTED", "PENDING_PUBLISHER", { id: user.id, role: "admin" }, "Article approved by admin");
      if (parties.publisherUserId) await notifyMany([parties.publisherUserId], "order.new", { order_id: orderId }, { subject: "New placement order", body: "A new order is ready for your review.", path: `/publisher/orders/${orderId}` });
    } else {
      await db.from("content_submissions").update({ review_status: "CHANGES_REQUESTED", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: note }).eq("order_id", orderId);
      await transitionOrder(orderId, "CONTENT_SUBMITTED", "PAID", { id: user.id, role: "admin" }, `Changes requested: ${note}`);
      await notifyMany(parties.customerUserIds, "article.changes_requested", { order_id: orderId },
        { subject: "Your article needs changes", body: `Our team asked for changes: ${note}`, path: `/dashboard/orders/${orderId}` });
    }
    await logAudit({ actorId: user.id, action: `article.${decision}`, resourceType: "order", resourceId: orderId });
    revalidatePath(back);
    redirect(back);
  });
}
