import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { logAudit } from "@/lib/audit";
import { REJECTION_RECOVERY_HOURS, RESTORATION_DEADLINE_HOURS } from "@/lib/payout-policy";

const restoreHours = () => Math.min(720, Math.max(1, Number(process.env.RESTORE_DEADLINE_HOURS) || RESTORATION_DEADLINE_HOURS));

// A verified link disappeared (confirmed by the monitoring policy, not one bad fetch). The ORIGINAL publisher owes a
// restoration at no extra charge to the customer and with no extra pay to the publisher; the case carries the deadline.
export async function openRestorationCase(orderId: string, reason: string, publisherUserId: string | null): Promise<void> {
  const db = createAdminClient();
  try {
    const { data: caseId, error } = await db.rpc("open_recovery_case", { p_order: orderId, p_kind: "link_restoration", p_reason: reason, p_actor: null, p_deadline_hours: restoreHours() });
    if (error) throw new Error(error.message);
    const { data: c } = await db.from("recovery_cases").select("deadline_at, created_at").eq("id", caseId as string).maybeSingle();
    if (publisherUserId && c && Date.now() - Date.parse(c.created_at) < 60_000) {
      await notifyMany([publisherUserId], "recovery.restoration_required", { order_id: orderId, deadline: c.deadline_at },
        { subject: "Please restore a link: action required", body: `A verified link on your site is no longer in place. Please restore it under the original order terms, at no extra charge, by ${new Date(c.deadline_at).toUTCString()}. Your original payment for this order does not change and no second payout is created.`, path: `/publisher/orders/${orderId}` });
    }
    await logAudit({ actorId: null, action: "recovery.restoration_opened", resourceType: "order", resourceId: orderId });
  } catch (e) {
    console.error("[recovery] restoration case", orderId, e instanceof Error ? e.message : "unknown");
    await notifyStaff("A restoration case could not be opened", `Order ${orderId} has a confirmed link issue but the restoration case could not be recorded.`, `/admin/orders/${orderId}`).catch(() => undefined);
  }
}

// The publisher declined a PAID order. The customer keeps their payment; the order enters recovery (never stranded).
export async function openRejectionCase(orderId: string, reason: string, actorId: string | null): Promise<string | null> {
  const db = createAdminClient();
  const { data: paid } = await db.from("payments").select("id").eq("order_id", orderId).eq("status", "PAID").maybeSingle();
  if (!paid) return null;                                   // never paid: no refund and no recovery needed
  const { data: id, error } = await db.rpc("open_recovery_case", { p_order: orderId, p_kind: "publisher_rejection", p_reason: reason, p_actor: actorId, p_deadline_hours: REJECTION_RECOVERY_HOURS });
  if (error) { console.error("[recovery] rejection case", error.message); throw new Error("Could not open the recovery case"); }
  await db.rpc("cancel_unpaid_payouts", { p_order: orderId, p_actor: actorId, p_reason: "Publisher declined the order" });
  return id as string;
}

/** Candidate replacement listings for admins to choose from: approved, priced for the order type, different publisher. */
export async function findReplacementCandidates(orderId: string, limit = 8) {
  const db = createAdminClient();
  const { data: o } = await db.from("orders").select("order_type, website_id, publisher_websites(niche, publisher_id)").eq("id", orderId).maybeSingle();
  if (!o) return [];
  const cur: any = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites;
  const priceCol = o.order_type === "guest_post" ? "price_guest_post" : "price_link_insertion";
  const { data } = await db.from("publisher_websites").select(`id, domain, niche, publisher_id, ${priceCol}`).eq("status", "approved").neq("publisher_id", cur?.publisher_id ?? "00000000-0000-0000-0000-000000000000").not(priceCol, "is", null).order(priceCol, { ascending: true }).limit(60);
  const rows: any[] = data ?? [];
  rows.sort((a, b) => Number(b.niche === cur?.niche) - Number(a.niche === cur?.niche) || Number(a[priceCol]) - Number(b[priceCol]));
  return rows.slice(0, limit).map((r) => ({ id: r.id as string, domain: r.domain as string, niche: r.niche as string | null, price: Number(r[priceCol]), sameNiche: r.niche === cur?.niche }));
}
