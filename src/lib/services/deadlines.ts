import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMany, notifyStaff } from "@/lib/services/notify";
import { orderParties } from "@/lib/services/orders";
import { logAudit } from "@/lib/audit";
import { formatDueUtc } from "@/lib/order-deadline";

// Tells the customer (and the publisher) that an accepted order is past its delivery deadline. Safe to run repeatedly and
// concurrently: `expiry_notified_at` is claimed with a compare-and-set update, so each order is announced exactly once.
// The order page shows the refund / alternative options from `due_at` directly, so a late or failed run never hides them.
export async function notifyExpiredOrders(limit = 50): Promise<number> {
  const db = createAdminClient();
  const { data: late } = await db.from("orders").select("id, due_at")
    .in("status", ["ACCEPTED", "IN_PROGRESS", "REPLACEMENT_REQUESTED"]).is("expiry_notified_at", null).lt("due_at", new Date().toISOString()).limit(limit);
  let announced = 0;
  for (const o of (late ?? []) as { id: string; due_at: string }[]) {
    try {
      const { data: claimed } = await db.from("orders").update({ expiry_notified_at: new Date().toISOString() })
        .eq("id", o.id).is("expiry_notified_at", null).in("status", ["ACCEPTED", "IN_PROGRESS", "REPLACEMENT_REQUESTED"]).select("id").maybeSingle();
      if (!claimed) continue;                                  // someone else announced it, or the order moved on
      const parties = await orderParties(o.id);
      if (!parties) continue;
      announced++;
      await notifyMany(parties.customerUserIds, "order.deadline_missed", { order_id: o.id, due_at: o.due_at }, {
        subject: "Your order is past its delivery deadline",
        body: `The publisher did not finish your placement by ${formatDueUtc(o.due_at)}. You can now ask for a refund or for an alternative placement. Nothing happens automatically: open the order and choose.`,
        path: `/dashboard/orders/${o.id}`
      });
      if (parties.publisherUserId) await notifyMany([parties.publisherUserId], "order.deadline_missed_publisher", { order_id: o.id, due_at: o.due_at }, {
        subject: "An order is past its delivery deadline",
        body: `The delivery deadline of ${formatDueUtc(o.due_at)} has passed. Please submit the published URL now. Until the customer chooses a refund or an alternative, you can still deliver; after that the order is closed for you and no payout is due.`,
        path: `/publisher/orders/${o.id}`
      });
      await logAudit({ actorId: null, action: "order.deadline_missed", resourceType: "order", resourceId: o.id });
    } catch (e) {
      console.error("[deadlines] notify failed", o.id, e instanceof Error ? e.message : "unknown");
    }
  }
  if (announced > 0) await notifyStaff("Orders past their delivery deadline", `${announced} order(s) passed their delivery deadline. The customers were notified and can now choose a refund or an alternative.`, "/admin/orders").catch(() => undefined);
  return announced;
}
