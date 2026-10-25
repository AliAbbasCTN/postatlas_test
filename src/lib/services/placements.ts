import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/safe-fetch";
import { evaluateFetch, classify, decideMonitoring, type CheckResult } from "@/lib/placement-eval";
import { transitionOrder, orderParties } from "@/lib/services/orders";
import { notifyMany } from "@/lib/services/notify";
import { logAudit } from "@/lib/audit";
import { onPlacementVerified } from "@/lib/services/payouts";
import { openRestorationCase } from "@/lib/services/recovery";
import type { OrderStatus } from "@/lib/types";

export type CheckTrigger = "publisher_submit" | "customer_request" | "scheduled" | "admin";

const CHECK_INTERVAL_HOURS = 24;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

// Runs ONE real check of a published placement and applies the consequences.
// Nothing is marked verified unless the fetched page actually contains the
// expected link; nothing is raised as an issue on a single bad fetch.
export async function runPlacementCheck(placementId: string, trigger: CheckTrigger, actorId: string | null): Promise<CheckResult | null> {
  const db = createAdminClient();
  const { data: placement } = await db
    .from("published_placements")
    .select("id, order_id, published_url, consecutive_failures, health, verified_at")
    .eq("id", placementId).maybeSingle();
  if (!placement) return null;

  const parties = await orderParties(placement.order_id);
  if (!parties) return null;
  const order = parties.order;
  const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;

  const outcome = await safeFetch(placement.published_url);
  const result = evaluateFetch(outcome, {
    publishedUrl: placement.published_url,
    targetUrl: order.target_url,
    anchorText: order.anchor_text,
    linkType: site?.link_type ?? null
  });

  await db.from("backlink_checks").insert({
    placement_id: placement.id, result: result.status, http_status: result.httpStatus, link_found: result.linkFound,
    anchor_matched: result.anchorMatched, attribute: result.attribute, reason: result.reason, message: result.message,
    final_url: result.finalUrl, response_ms: result.responseMs, noindex_detected: result.noindexDetected,
    trigger, checked_by: actorId
  });

  const status = order.status as OrderStatus;
  const now = new Date().toISOString();
  const customerEmailLink = `/dashboard/orders/${order.id}`;

  // ---- initial verification --------------------------------------------
  if (status === "PUBLISHED" || status === "VERIFICATION_PENDING") {
    if (status === "PUBLISHED") await transitionOrder(order.id, "PUBLISHED", "VERIFICATION_PENDING", { id: null, role: "system" }, "Automatic link check started");
    if (result.status === "VERIFIED") {
      await transitionOrder(order.id, "VERIFICATION_PENDING", "VERIFIED", { id: actorId, role: "system" }, result.message);
      await transitionOrder(order.id, "VERIFIED", "MONITORING", { id: null, role: "system" }, "Monitoring started");
      await db.from("published_placements").update({
        health: "HEALTHY", consecutive_failures: 0, last_checked_at: now, verified_at: now, next_check_at: hoursFromNow(CHECK_INTERVAL_HOURS), updated_at: now
      }).eq("id", placement.id);
      await onPlacementVerified(order.id, now);    // records the publisher's payout obligation (idempotent: a replacement never creates a second payout)
      await db.rpc("mark_case_restored", { p_order: order.id });   // a verified replacement also closes an open link-restoration case (no-op otherwise)
      await notifyMany(parties.customerUserIds, "placement.verified", { order_id: order.id },
        { subject: "Your placement is live and verified", body: "We found your link on the published page. Monitoring is now active (including after a replacement).", path: customerEmailLink });
    } else {
      await db.from("published_placements").update({ health: result.status === "REQUIRES_REVIEW" ? "NEEDS_REVIEW" : "PENDING", last_checked_at: now, updated_at: now }).eq("id", placement.id);
      if (parties.publisherUserId) {
        await notifyMany([parties.publisherUserId], "placement.verification_failed", { order_id: order.id, reason: result.reason },
          { subject: "We could not verify the published link", body: `${result.message} Please check the page and resubmit the URL if needed.`, path: `/publisher/orders/${order.id}` });
      }
    }
    return result;
  }

  // ---- ongoing monitoring ---------------------------------------------------
  if (status === "MONITORING" || status === "ISSUE_DETECTED") {
    const verdict = classify(result);
    const decision = decideMonitoring({ consecutiveFailures: placement.consecutive_failures, orderIsIssue: status === "ISSUE_DETECTED" }, verdict);
    const update: Record<string, unknown> = {
      consecutive_failures: decision.nextFailures, last_checked_at: now, next_check_at: hoursFromNow(CHECK_INTERVAL_HOURS), updated_at: now
    };

    if (decision.action === "raise_issue") {
      await transitionOrder(order.id, "MONITORING", "ISSUE_DETECTED", { id: null, role: "system" }, result.message);
      update.health = "ISSUE";
      await db.from("backlink_monitoring_events").insert({
        placement_id: placement.id, event_type: result.status === "REQUIRES_REVIEW" ? "NEEDS_REVIEW" : result.status, message: result.message, detail: { reason: result.reason, http_status: result.httpStatus }
      });
      await logAudit({ actorId: null, organizationId: order.organization_id, action: "placement.issue_detected", resourceType: "order", resourceId: order.id, metadata: { reason: result.reason } });
      await notifyMany(parties.customerUserIds, "placement.issue", { order_id: order.id, reason: result.reason },
        { subject: "An issue was detected with one of your placements", body: `${result.message} The publisher has been asked to restore it at no extra cost to you.`, path: customerEmailLink });
      await openRestorationCase(order.id, result.message, parties.publisherUserId);
    } else if (decision.action === "recover") {
      await transitionOrder(order.id, "ISSUE_DETECTED", "MONITORING", { id: null, role: "system" }, "Link found again");
      update.health = "HEALTHY";
      await db.from("backlink_monitoring_events").insert({ placement_id: placement.id, event_type: "RECOVERED", message: "The link is present again." });
      await createAdminClient().rpc("mark_case_restored", { p_order: order.id });
      await notifyMany(parties.customerUserIds, "placement.recovered", { order_id: order.id }, { subject: "Placement issue resolved", body: "The link is present again.", path: customerEmailLink });
      if (parties.publisherUserId) await notifyMany([parties.publisherUserId], "placement.recovered", { order_id: order.id }, { subject: "Thank you: the link was restored", body: "Our check found the link again, so the restoration request is closed.", path: `/publisher/orders/${order.id}` });
    } else if (verdict === "ok" && status === "MONITORING") {
      update.health = "HEALTHY";
    } else if (verdict === "inconclusive") {
      update.health = status === "ISSUE_DETECTED" ? "ISSUE" : "NEEDS_REVIEW";
      await db.from("backlink_monitoring_events").insert({ placement_id: placement.id, event_type: "NEEDS_REVIEW", message: result.message, detail: { reason: result.reason } });
    }
    await db.from("published_placements").update(update).eq("id", placement.id);
  }
  return result;
}

// Used by the scheduled route. Leases due placements atomically in Postgres so
// overlapping runs never double-check, then checks a few at a time.
export async function runDueChecks(limit = 25): Promise<{ checked: number }> {
  const { data, error } = await createAdminClient().rpc("claim_due_placements", { p_limit: limit });
  if (error) throw new Error(`claim_due_placements failed: ${error.message}`);
  const rows = (data ?? []) as { id: string }[];
  let checked = 0;
  for (let i = 0; i < rows.length; i += 3) {
    const batch = rows.slice(i, i + 3);
    await Promise.all(batch.map(async (r) => {
      try { await runPlacementCheck(r.id, "scheduled", null); checked++; }
      catch (e) { console.error("[monitor] check failed", r.id, e instanceof Error ? e.message : "unknown"); }
    }));
  }
  return { checked };
}
