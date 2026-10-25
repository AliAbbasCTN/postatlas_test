"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, actionWorkspace, assertWorkspaceCapability } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf } from "@/lib/validation";
import { NICHES } from "@/lib/niches";
import { normalizeDomain, validatePublicHttpUrl } from "@/lib/url-safety";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { runAudit } from "@/lib/services/audit-engine";

export async function addWebsite(formData: FormData) {
  return withRedirect("/dashboard/websites", async () => {
    const { user, org } = await actionWorkspace("manageWebsites");
    const domain = normalizeDomain(text(formData, "domain", "Website", { max: 300 }));
    if (!domain) throw new ActionError("Please enter a valid public website address, like example.com.");
    const category = oneOf(formData, "category", "Topic", NICHES);
    const db = createAdminClient();
    const { count } = await db.from("websites").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
    if ((count ?? 0) >= 25) throw new ActionError("You have reached the limit of 25 websites.");
    const { data, error } = await db.from("websites").insert({ organization_id: org.id, domain, category, created_by: user.id }).select("id").single();
    if (error || !data) {
      if (error?.code === "23505") throw new ActionError("That website is already on your account.");
      console.error("[addWebsite]", error?.message);
      throw new ActionError("Could not add the website.");
    }
    await logAudit({ actorId: user.id, organizationId: org.id, action: "website.added", resourceType: "website", resourceId: data.id, metadata: { domain } });
    revalidatePath("/dashboard/websites");
    redirect(`/dashboard/websites/${data.id}?added=1`);
  });
}

export async function analyzeWebsite(formData: FormData) {
  const id = String(formData.get("website_id") ?? "");
  return withRedirect(`/dashboard/websites/${/^[0-9a-f-]{36}$/i.test(id) ? id : ""}`, async () => {
    const { user } = await actionSession();
    const websiteId = uuid(formData, "website_id");
    await rateLimit(`audit:${user.id}`, LIMITS.audit.window, LIMITS.audit.max);
    const db = createAdminClient();
    const { data: site } = await db.from("websites").select("id, organization_id, domain, category").eq("id", websiteId).maybeSingle();
    // Authorised by the caller's role in the workspace that OWNS the website (personal or team), not the active one.
    await assertWorkspaceCapability(user.id, site?.organization_id, "manageWebsites", "Website not found.");
    if (!site) throw new ActionError("Website not found.");
    const result = await runAudit(site, user.id);
    await logAudit({ actorId: user.id, organizationId: site.organization_id, action: "audit.run", resourceType: "website", resourceId: site.id, metadata: { pages: result.pages, link_data: result.linkData } });
    revalidatePath(`/dashboard/websites/${site.id}`);
    redirect(`/dashboard/websites/${site.id}?analyzed=1`);
  });
}

// "I want to strengthen this page" - an opportunity the customer chose themselves.
// It carries no authority numbers because none were measured.
export async function selectPageAsOpportunity(formData: FormData) {
  const sid = String(formData.get("website_id") ?? "");
  return withRedirect(`/dashboard/websites/${/^[0-9a-f-]{36}$/i.test(sid) ? sid : ""}`, async () => {
    const { user } = await actionSession();
    const websiteId = uuid(formData, "website_id");
    const pageUrl = text(formData, "page_url", "Page", { max: 2048 });
    const db = createAdminClient();
    const { data: site } = await db.from("websites").select("id, organization_id, domain, category").eq("id", websiteId).maybeSingle();
    await assertWorkspaceCapability(user.id, site?.organization_id, "manageWebsites", "Website not found.");
    if (!site) throw new ActionError("Website not found.");
    const check = validatePublicHttpUrl(pageUrl);
    if (!check.ok || check.url.hostname.replace(/^www\./, "") !== site.domain) throw new ActionError("That page does not belong to this website.");
    const clean = new URL(check.url.toString()); clean.hash = "";
    const { data: pageRow } = await db.from("audit_pages").select("title").eq("website_id", site.id).eq("url", clean.toString()).order("observed_at", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await db.from("opportunities").upsert(
      { website_id: site.id, organization_id: site.organization_id, page_url: clean.toString(), page_title: pageRow?.title ?? null, category: site.category, kind: "customer_selected", status: "OPEN" },
      { onConflict: "website_id,page_url", ignoreDuplicates: true }
    ).select("id").maybeSingle();
    if (error) { console.error("[selectPage]", error.message); throw new ActionError("Could not save that page."); }
    let id = data?.id as string | undefined;
    if (!id) {
      const { data: existing } = await db.from("opportunities").select("id").eq("website_id", site.id).eq("page_url", clean.toString()).maybeSingle();
      id = existing?.id;
    }
    await logAudit({ actorId: user.id, organizationId: site.organization_id, action: "opportunity.selected", resourceType: "opportunity", resourceId: id ?? null });
    revalidatePath("/dashboard/opportunities");
    redirect(`/dashboard/opportunities/${id}`);
  });
}

export async function dismissOpportunity(formData: FormData) {
  return withRedirect("/dashboard/opportunities", async () => {
    const { user } = await actionSession();
    const id = uuid(formData, "opportunity_id");
    const db = createAdminClient();
    const { data: opp } = await db.from("opportunities").select("id, organization_id").eq("id", id).maybeSingle();
    await assertWorkspaceCapability(user.id, opp?.organization_id, "manageWebsites", "Opportunity not found.");
    await db.from("opportunities").update({ status: "DISMISSED" }).eq("id", id).eq("organization_id", opp!.organization_id);
    revalidatePath("/dashboard/opportunities");
    redirect("/dashboard/opportunities");
  });
}

// After a visitor ran the public check and chose to order, they sign in and land here: add that website to their
// organization (once) and continue to the order form. Everything is re-validated; the check id only supplies the
// domain, topic and page list that the server itself produced.
export async function startFromCheck(formData: FormData) {
  const rawCheck = String(formData.get("check") ?? "");
  const back = `/dashboard/start?check=${/^[0-9a-f-]{36}$/i.test(rawCheck) ? rawCheck : ""}`;
  return withRedirect(back, async () => {
    const { user, org } = await actionWorkspace("manageWebsites");
    const checkId = uuid(formData, "check", "Report");
    const publisherId = uuid(formData, "publisher", "Publisher");
    const db = createAdminClient();
    const { data: check } = await db.from("site_checks").select("domain, category, result").eq("id", checkId).maybeSingle();
    if (!check) throw new ActionError("That report is no longer available. Please run the check again.");
    // The chosen publisher must still be an approved listing with a price (the order form re-checks and prices it again).
    const { data: listing } = await db.from("publisher_websites").select("id, status, price_guest_post, price_link_insertion").eq("id", publisherId).maybeSingle();
    if (!listing || listing.status !== "approved" || (listing.price_guest_post == null && listing.price_link_insertion == null)) {
      throw new ActionError("That publisher is not available for orders right now. Please pick another from your report.");
    }

    let { data: site } = await db.from("websites").select("id, domain").eq("organization_id", org.id).eq("domain", check.domain).maybeSingle();
    if (!site) {
      const { count } = await db.from("websites").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
      if ((count ?? 0) >= 25) throw new ActionError("You have reached the limit of 25 websites.");
      const { data: created, error } = await db.from("websites").insert({ organization_id: org.id, domain: check.domain, category: check.category, created_by: user.id }).select("id, domain").single();
      if (error || !created) { console.error("[startFromCheck]", error?.message); throw new ActionError("Could not add the website."); }
      site = created;
      await logAudit({ actorId: user.id, organizationId: org.id, action: "website.added", resourceType: "website", resourceId: created.id, metadata: { domain: check.domain, via: "public_check" } });
    }
    // The page to link to must be one the check actually saw on THIS domain (default: the homepage).
    const known = new Set<string>([`https://${check.domain}/`, ...((check.result?.pages ?? []) as { url: string }[]).map((p) => p.url)]);
    const wanted = String(formData.get("target") ?? "").trim();
    const target = known.has(wanted) ? wanted : `https://${check.domain}/`;
    redirect(`/dashboard/orders/new?publisher=${publisherId}&target=${encodeURIComponent(target)}`);
  });
}
