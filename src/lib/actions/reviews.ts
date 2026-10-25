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
import { notifyMany } from "@/lib/services/notify";
import { canReviewOrder, parseRating, MAX_COMMENT, MIN_COMMENT } from "@/lib/review";

const REVIEW_ERRORS: [RegExp, string][] = [
  [/already been reviewed|site_reviews_order_id_key|duplicate key/i, "This order has already been reviewed."],
  [/published and verified/i, "You can review a website once your placement has been published and verified."],
  [/role in this workspace/i, "Your role in this workspace does not allow that action."],
  [/too short/i, "Please write at least a few words, or leave the feedback empty."]
];

// A customer rates the website that delivered their placement (1-5 stars, optional written feedback), once per order.
// The review is attached to the LISTING and shown on its public page; the reviewer is never named.
export async function submitSiteReview(formData: FormData) {
  const raw = String(formData.get("order_id") ?? "");
  const back = `/dashboard/orders/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`;
  return withRedirect(`${back}#review`, async () => {
    const { user } = await actionSession();
    await rateLimit(`review:${user.id}`, LIMITS.review.window, LIMITS.review.max);
    const orderId = uuid(formData, "order_id");
    const rating = parseRating(formData.get("rating"));
    if (rating == null) throw new ActionError("Choose a rating from 1 to 5 stars.");
    const comment = text(formData, "comment", "Feedback", { min: MIN_COMMENT, max: MAX_COMMENT, optional: true, multiline: true });
    // Reviews are public text on a link marketplace: no links (they would be free backlinks and spam).
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|info|biz|xyz|pk)\b/i.test(comment)) throw new ActionError("Please leave web addresses out of your feedback.");

    const order = await loadOrderFor(orderId, { kind: "member", userId: user.id, cap: "manageOrders" });
    if (!order) throw new ActionError("Order not found.");
    const db = createAdminClient();
    const [{ data: placement }, { data: existing }] = await Promise.all([
      db.from("published_placements").select("verified_at").eq("order_id", order.id).maybeSingle(),
      db.from("site_reviews").select("id").eq("order_id", order.id).maybeSingle()
    ]);
    const verdict = canReviewOrder({ status: order.status, hasVerifiedPlacement: !!placement?.verified_at, alreadyReviewed: !!existing });
    if (!verdict.ok) throw new ActionError(verdict.reason);

    const { error } = await db.rpc("submit_site_review", { p_order: order.id, p_user: user.id, p_rating: rating, p_comment: comment || null });
    if (error) {
      const known = REVIEW_ERRORS.find(([re]) => re.test(error.message) || re.test(error.code ?? ""));
      if (!known) console.error("[submitSiteReview]", error.message);
      throw new ActionError(known ? known[1] : "Could not save your review. Please try again.");
    }
    const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;
    await logAudit({ actorId: user.id, organizationId: order.organization_id, action: "review.submitted", resourceType: "order", resourceId: order.id, metadata: { rating } });
    const parties = await orderParties(order.id);
    if (parties?.publisherUserId) await notifyMany([parties.publisherUserId], "review.received", { order_id: order.id, rating }, { subject: `New review for ${site?.domain ?? "your website"}`, body: `A customer rated ${site?.domain ?? "your website"} ${rating} out of 5 after a completed placement. The review appears on the website's listing.`, path: `/publisher/orders/${order.id}` });
    if (site?.domain) revalidatePath(`/publishers/${encodeURIComponent(site.domain)}`);
    revalidatePath("/publishers"); revalidatePath(back);
    redirect(`${back}?notice=${encodeURIComponent("Thank you. Your review is now shown on the website's listing.")}#review`);
  });
}

// Staff can hide a review that breaks the rules (abuse, personal data, an off-topic complaint) and restore it. The text is never edited.
export async function moderateReview(formData: FormData) {
  return withRedirect("/admin/reviews", async () => {
    const { user } = await actionAdmin();
    const reviewId = uuid(formData, "review_id");
    const decision = oneOf(formData, "decision", "Decision", ["hide", "restore"] as const);
    const reason = text(formData, "reason", "Reason", { min: 5, max: 500, optional: decision === "restore" });
    const { error } = await createAdminClient().rpc("moderate_site_review", { p_review: reviewId, p_admin: user.id, p_hide: decision === "hide", p_reason: reason || null });
    if (error) { console.error("[moderateReview]", error.message); throw new ActionError(/reason is required/i.test(error.message) ? "A reason is required to hide a review." : "Could not update the review."); }
    await logAudit({ actorId: user.id, action: decision === "hide" ? "review.hidden" : "review.restored", resourceType: "review", resourceId: reviewId, metadata: { reason: reason.slice(0, 200) } });
    // The public listing page is cached for an hour: refresh the one this review belongs to.
    const { data: r } = await createAdminClient().from("site_reviews").select("publisher_websites(domain)").eq("id", reviewId).maybeSingle();
    const w = r ? (Array.isArray((r as any).publisher_websites) ? (r as any).publisher_websites[0] : (r as any).publisher_websites) : null;
    if (w?.domain) revalidatePath(`/publishers/${encodeURIComponent(w.domain)}`);
    revalidatePath("/admin/reviews"); revalidatePath("/publishers");
    redirect("/admin/reviews?done=1");
  });
}
