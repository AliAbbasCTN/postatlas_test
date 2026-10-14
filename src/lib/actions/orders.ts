"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, actionWorkspace } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, optionalUuid, oneOf } from "@/lib/validation";
import { validatePublicHttpUrl } from "@/lib/url-safety";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { transitionOrder, loadOrderFor } from "@/lib/services/orders";
import { notifyStaff } from "@/lib/services/notify";
import { lockCheckout } from "@/lib/services/finance";
import type { Currency } from "@/lib/money";

const ORDER_TYPES = ["guest_post", "link_insertion"] as const;

// The price is read from the publisher's current approved listing on the server.
// Nothing about price, status or ownership is accepted from the browser.
export async function createOrder(formData: FormData) {
  const pubId = String(formData.get("publisher_id") ?? "");
  return withRedirect(`/dashboard/orders/new?publisher=${/^[0-9a-f-]{36}$/i.test(pubId) ? pubId : ""}`, async () => {
    const { user, org } = await actionWorkspace("manageOrders");
    await rateLimit(`order:${user.id}`, LIMITS.order.window, LIMITS.order.max);
    const publisherId = uuid(formData, "publisher_id", "Publisher");
    const orderType = oneOf(formData, "order_type", "Placement type", ORDER_TYPES);
    const opportunityId = optionalUuid(formData, "opportunity_id", "Opportunity");
    const anchor = text(formData, "anchor_text", "Anchor text", { max: 100, optional: true });
    // One select carries "<method id>:<currency>", so the browser can only offer valid pairs; the server re-validates the pair.
    const [methodRaw = "", currencyRaw = ""] = String(formData.get("checkout") ?? "").split(":");
    if (!/^[0-9a-f-]{36}$/i.test(methodRaw) || (currencyRaw !== "USD" && currencyRaw !== "PKR")) throw new ActionError("Choose how you want to pay.");
    const methodId = methodRaw;
    const currency = currencyRaw as Currency;

    const db = createAdminClient();
    const { data: listing } = await db.from("publisher_websites")
      .select("id, domain, status, price_guest_post, price_link_insertion").eq("id", publisherId).maybeSingle();
    if (!listing || listing.status !== "approved") throw new ActionError("This publisher is not available for orders right now.");
    const price = orderType === "guest_post" ? listing.price_guest_post : listing.price_link_insertion;
    if (price == null || Number(price) <= 0) throw new ActionError("This publisher has not set a price for that placement type.");

    // The target page must be a page on one of THIS organisation's websites.
    let targetUrl: string;
    let oppId: string | null = null;
    if (opportunityId) {
      const { data: opp } = await db.from("opportunities").select("id, page_url").eq("id", opportunityId).eq("organization_id", org.id).maybeSingle();
      if (!opp) throw new ActionError("That opportunity was not found.");
      targetUrl = opp.page_url; oppId = opp.id;
    } else {
      targetUrl = text(formData, "target_url", "Target page", { max: 2048 });
    }
    const check = validatePublicHttpUrl(targetUrl);
    if (!check.ok) throw new ActionError(check.reason);
    const host = check.url.hostname.toLowerCase().replace(/^www\./, "");
    const { data: site } = await db.from("websites").select("id").eq("organization_id", org.id).eq("domain", host).maybeSingle();
    if (!site) throw new ActionError("The target page must be on one of the websites you have added. Add the website first.");
    check.url.hash = "";
    const clean = check.url.toString();

    // Price, commission and payable amount are decided here on the server from the listing row. The browser only names a
    // currency and a payment method; the database re-derives and checks every figure before the order exists.
    const locked = await lockCheckout(Number(price).toFixed(2), currency, methodId);
    const { data: orderId, error } = await db.rpc("create_order_priced", {
      p_org: org.id, p_user: user.id, p_listing: listing.id, p_customer_site: site.id, p_opportunity: oppId, p_type: orderType, p_target: clean, p_anchor: anchor || null,
      p_currency: currency, p_method: methodId, p_fx_rate: locked.fxRate, p_fx_source: locked.fxSource, p_fx_at: locked.fxAt, p_expected_due: locked.amountDue
    });
    if (error || typeof orderId !== "string") {
      if (error?.code === "23505") throw new ActionError("You already have an open order for this publisher and page.");
      console.error("[createOrder]", error?.message);
      throw new ActionError(/exchange rate|PKR/i.test(error?.message ?? "") ? "PKR checkout is not available right now. Pay in USD or try again later." : "Could not create the order.");
    }
    const order = { id: orderId };
    await logAudit({ actorId: user.id, organizationId: org.id, action: "order.created", resourceType: "order", resourceId: order.id, metadata: { order_type: orderType, currency, list_price_usd: Number(price) } });
    revalidatePath("/dashboard/orders");
    redirect(`/dashboard/orders/${order.id}?created=1`);
  });
}

export async function cancelOrder(formData: FormData) {
  const raw = String(formData.get("order_id") ?? "");
  return withRedirect(`/dashboard/orders/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`, async () => {
    const { user } = await actionSession();
    const id = uuid(formData, "order_id");
    const order = await loadOrderFor(id, { kind: "member", userId: user.id, cap: "manageOrders" });
    if (!order) throw new ActionError("Order not found.");
    await transitionOrder(order.id, order.status, "CANCELLED", { id: user.id, role: "customer" }, "Cancelled by customer");
    await logAudit({ actorId: user.id, organizationId: order.organization_id, action: "order.cancelled", resourceType: "order", resourceId: order.id });
    revalidatePath("/dashboard/orders");
    redirect(`/dashboard/orders/${order.id}`);
  });
}

export async function requestReplacement(formData: FormData) {
  const raw = String(formData.get("order_id") ?? "");
  return withRedirect(`/dashboard/orders/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`, async () => {
    const { user } = await actionSession();
    const id = uuid(formData, "order_id");
    const order = await loadOrderFor(id, { kind: "member", userId: user.id, cap: "manageOrders" });
    if (!order) throw new ActionError("Order not found.");
    await transitionOrder(order.id, order.status, "REPLACEMENT_REQUESTED", { id: user.id, role: "customer" }, "Customer asked for a replacement");
    await notifyStaff("Replacement requested", `A customer asked for a replacement on order ${order.id}.`, `/admin/orders/${order.id}`);
    await logAudit({ actorId: user.id, organizationId: order.organization_id, action: "order.replacement_requested", resourceType: "order", resourceId: order.id });
    revalidatePath(`/dashboard/orders/${order.id}`);
    redirect(`/dashboard/orders/${order.id}?notice=${encodeURIComponent("Replacement requested. Our team will follow up.")}`);
  });
}
