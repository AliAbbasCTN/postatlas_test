import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionError } from "@/lib/action-utils";
import { canTransition, type Actor } from "@/lib/order-state";
import { logAudit } from "@/lib/audit";
import { orgCan, type Capability } from "@/lib/permissions";
import type { OrderStatus } from "@/lib/types";

// The one place order status changes. It checks the rule table for this actor,
// then performs a compare-and-set in Postgres (transition_order) which also
// writes the order_events history row. If the order moved in the meantime the
// call fails instead of overwriting.
export async function transitionOrder(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  actor: { id: string | null; role: Actor },
  note?: string
): Promise<void> {
  if (!canTransition(from, to, actor.role)) throw new ActionError("That step is not available for this order.");
  const { data, error } = await createAdminClient().rpc("transition_order", {
    p_order: orderId, p_from: from, p_to: to, p_actor: actor.id, p_actor_role: actor.role, p_note: note ?? null
  });
  if (error) {
    console.error("[transitionOrder]", error.message);
    throw new ActionError("Could not update the order. Please try again.");
  }
  if (data !== true) throw new ActionError("This order was just updated by someone else. Please refresh and try again.");
}

export async function addOrderEvent(orderId: string, actor: { id: string | null; role: Actor }, eventType: string, note: string) {
  await createAdminClient().from("order_events").insert({
    order_id: orderId, actor_id: actor.id, actor_role: actor.role, event_type: eventType, note: note.slice(0, 500)
  });
}

// Loads an order and proves the caller may touch it. `scope` decides how:
//   member    the caller (identified by the authenticated session) belongs to the workspace that OWNS the order
//             - their own personal workspace or a team - with a role that holds `cap`. This is the customer path.
//             A caller who is not a member gets null (indistinguishable from "no such order"); a member whose
//             role lacks `cap` gets an ActionError saying so.
//   publisher the order is on a listing owned by this publisher account (directly or via their agency profile).
//   admin     staff; the caller must already have passed actionAdmin().
export async function loadOrderFor(
  orderId: string,
  scope: { kind: "member"; userId: string; cap: Capability } | { kind: "publisher"; userId: string } | { kind: "admin" }
) {
  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, organization_id, website_id, customer_website_id, opportunity_id, order_type, target_url, anchor_text, customer_price, status, created_by, created_at, publisher_websites(id, domain, link_type, publisher_id, publisher_profiles(user_id))")
    .eq("id", orderId).maybeSingle();
  if (!order) return null;
  if (scope.kind === "member") {
    const { data: m } = await db.from("organization_members").select("role")
      .eq("organization_id", order.organization_id).eq("user_id", scope.userId).maybeSingle();
    if (!m) return null;
    if (!orgCan(m.role as never, scope.cap)) throw new ActionError("Your role in this workspace does not allow that action.");
  }
  if (scope.kind === "publisher") {
    const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;
    const prof = Array.isArray(site?.publisher_profiles) ? site?.publisher_profiles[0] : site?.publisher_profiles;
    if (!prof || prof.user_id !== scope.userId) return null;
  }
  return order;
}

export async function orderParties(orderId: string) {
  const db = createAdminClient();
  const order = await loadOrderFor(orderId, { kind: "admin" });
  if (!order) return null;
  const site = Array.isArray(order.publisher_websites) ? order.publisher_websites[0] : order.publisher_websites;
  const prof = Array.isArray(site?.publisher_profiles) ? site?.publisher_profiles[0] : site?.publisher_profiles;
  const { data: owners } = await db.from("organization_members").select("user_id").eq("organization_id", order.organization_id).in("role", ["owner", "seo_manager"]);
  return {
    order,
    publisherUserId: (prof?.user_id as string | undefined) ?? null,
    customerUserIds: [...new Set([order.created_by as string, ...((owners ?? []).map((o: { user_id: string }) => o.user_id))])]
  };
}
