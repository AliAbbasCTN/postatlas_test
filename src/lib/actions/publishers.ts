"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, actionPublisher, actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, oneOf, integer, money } from "@/lib/validation";
import { NICHES } from "@/lib/niches";
import { normalizeDomain } from "@/lib/url-safety";
import { rateLimit } from "@/lib/rate-limit";
import { notifyUser } from "@/lib/services/notify";

const LINK_TYPES = ["dofollow", "nofollow", "mixed"] as const;
const idOf = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^[0-9a-f-]{36}$/i.test(v) ? v : ""; };

// Anyone signed in can APPLY. The publisher role itself is granted only by an admin.
export async function applyAsPublisher(formData: FormData) {
  return withRedirect("/apply-publisher", async () => {
    const { user } = await actionSession();
    await rateLimit(`pubapply:${user.id}`, 86400, 3);
    const displayName = text(formData, "display_name", "Name or company", { min: 2, max: 100 });
    const bio = text(formData, "bio", "About your sites", { min: 20, max: 1000, multiline: true });
    const db = createAdminClient();
    const { error } = await db.from("publisher_profiles").insert({ user_id: user.id, display_name: displayName, bio, approved: false });
    if (error) {
      if (error.code === "23505") throw new ActionError("You have already applied.");
      console.error("[applyAsPublisher]", error.message);
      throw new ActionError("Could not submit your application.");
    }
    await logAudit({ actorId: user.id, action: "publisher.applied", resourceType: "publisher_profile" });
    redirect("/apply-publisher?submitted=1");
  });
}

function listingFields(fd: FormData) {
  const domain = normalizeDomain(text(fd, "domain", "Domain", { max: 300 }));
  if (!domain) throw new ActionError("Please enter a valid domain, like example.com.");
  const gp = money(fd, "price_guest_post", "Guest post price", { max: 100000, optional: true });
  const li = money(fd, "price_link_insertion", "Link insertion price", { max: 100000, optional: true });
  if (gp == null && li == null) throw new ActionError("Set a price for at least one placement type.");
  const tmin = integer(fd, "turnaround_days_min", "Minimum turnaround", { min: 1, max: 120, optional: true });
  const tmax = integer(fd, "turnaround_days_max", "Maximum turnaround", { min: 1, max: 120, optional: true });
  if (tmin != null && tmax != null && tmin > tmax) throw new ActionError("Minimum turnaround cannot be longer than the maximum.");
  return {
    domain,
    description: text(fd, "description", "Description", { max: 1000, optional: true, multiline: true }) || null,
    niche: oneOf(fd, "niche", "Topic", NICHES),
    country: text(fd, "country", "Country", { max: 60, optional: true }) || null,
    language: text(fd, "language", "Language", { max: 40, optional: true }) || null,
    price_guest_post: gp, price_link_insertion: li, turnaround_days_min: tmin, turnaround_days_max: tmax,
    link_type: oneOf(fd, "link_type", "Link type", LINK_TYPES),
    article_requirements: text(fd, "article_requirements", "Content requirements", { max: 2000, optional: true, multiline: true }) || null
  };
}

async function approvedProfile(userId: string) {
  const { data } = await createAdminClient().from("publisher_profiles").select("id, approved").eq("user_id", userId).maybeSingle();
  if (!data || !data.approved) throw new ActionError("Your publisher account is not approved yet.");
  return data.id as string;
}

function selfReportedMetrics(fd: FormData) {
  return {
    dr: integer(fd, "dr", "DR", { min: 0, max: 100, optional: true }),
    da: integer(fd, "da", "DA", { min: 0, max: 100, optional: true }),
    organic_traffic: integer(fd, "organic_traffic", "Monthly traffic", { min: 0, max: 2_000_000_000, optional: true })
  };
}

// A new or edited listing always goes (back) to admin review, and its numbers are labelled self-reported.
export async function saveListing(formData: FormData) {
  return withRedirect("/publisher/listings", async () => {
    const { user } = await actionPublisher();
    await rateLimit(`listing:${user.id}`, 3600, 20);
    const publisherId = await approvedProfile(user.id);
    const fields = listingFields(formData);
    const metrics = selfReportedMetrics(formData);
    const db = createAdminClient();
    const listingId = String(formData.get("listing_id") ?? "").trim();

    let id: string;
    if (listingId) {
      id = uuid(formData, "listing_id");
      const { data: own } = await db.from("publisher_websites").select("id").eq("id", id).eq("publisher_id", publisherId).maybeSingle();
      if (!own) throw new ActionError("Listing not found.");
      const { error } = await db.from("publisher_websites").update({ ...fields, status: "pending_review", rejection_reason: null }).eq("id", id);
      if (error) throw new ActionError(error.code === "23505" ? "That domain is already listed." : "Could not save the listing.");
    } else {
      const { count } = await db.from("publisher_websites").select("id", { count: "exact", head: true }).eq("publisher_id", publisherId);
      if ((count ?? 0) >= 50) throw new ActionError("Listing limit reached.");
      const { data, error } = await db.from("publisher_websites").insert({ ...fields, publisher_id: publisherId, status: "pending_review" }).select("id").single();
      if (error || !data) throw new ActionError(error?.code === "23505" ? "That domain is already listed." : "Could not save the listing.");
      id = data.id;
    }
    // Any publisher edit resets metrics to self-reported/unverified.
    await db.from("publisher_metrics").upsert({ website_id: id, ...metrics, verified: false, verified_at: null, metrics_source: "self_reported", verified_by: null }, { onConflict: "website_id" });
    await logAudit({ actorId: user.id, action: listingId ? "listing.updated" : "listing.created", resourceType: "publisher_website", resourceId: id });
    revalidatePath("/publisher/listings");
    redirect("/publisher/listings?saved=1");
  });
}

// ---- admin ------------------------------------------------------------------------

export async function reviewPublisherApplication(formData: FormData) {
  return withRedirect("/admin/publishers", async () => {
    const { user, platformRole } = await actionAdmin();
    const profileId = uuid(formData, "profile_id");
    const decision = oneOf(formData, "decision", "Decision", ["approve", "reject"] as const);
    const db = createAdminClient();
    const { data: profile } = await db.from("publisher_profiles").select("id, user_id").eq("id", profileId).maybeSingle();
    if (!profile) throw new ActionError("Application not found.");
    if (decision === "approve") {
      const { data: target } = await db.from("profiles").select("platform_role").eq("id", profile.user_id).maybeSingle();
      // Never downgrade an admin to publisher.
      if (target?.platform_role === "user") await db.from("profiles").update({ platform_role: "publisher" }).eq("id", profile.user_id);
      await db.from("publisher_profiles").update({ approved: true }).eq("id", profileId);
    } else {
      await db.from("publisher_profiles").update({ approved: false }).eq("id", profileId);
      const { data: target } = await db.from("profiles").select("platform_role").eq("id", profile.user_id).maybeSingle();
      if (target?.platform_role === "publisher") await db.from("profiles").update({ platform_role: "user" }).eq("id", profile.user_id);
    }
    await logAudit({ actorId: user.id, action: `publisher.${decision}d`, resourceType: "publisher_profile", resourceId: profileId, metadata: { by_role: platformRole } });
    await notifyUser(profile.user_id, `publisher.${decision}`, {}, decision === "approve"
      ? { subject: "Your PostAtlas publisher account was approved", body: "You can now add your websites and receive orders.", path: "/publisher" } : undefined);
    revalidatePath("/admin/publishers");
    redirect("/admin/publishers");
  });
}

export async function reviewListing(formData: FormData) {
  return withRedirect("/admin/publishers", async () => {
    const { user } = await actionAdmin();
    const id = uuid(formData, "listing_id");
    const decision = oneOf(formData, "decision", "Decision", ["approve", "reject", "suspend"] as const);
    const reason = text(formData, "reason", "Reason", { max: 500, optional: decision === "approve", multiline: true });
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "suspended";
    const db = createAdminClient();
    const { error } = await db.from("publisher_websites").update({
      status, rejection_reason: decision === "approve" ? null : reason, reviewed_by: user.id,
      last_verified_at: decision === "approve" ? new Date().toISOString() : null
    }).eq("id", id);
    if (error) throw new ActionError("Could not update the listing.");
    await logAudit({ actorId: user.id, action: `listing.${status}`, resourceType: "publisher_website", resourceId: id });
    revalidatePath("/admin/publishers"); revalidatePath("/publishers");
    redirect("/admin/publishers");
  });
}

// "Verified" metrics mean an admin checked these figures against an independent source.
export async function verifyMetrics(formData: FormData) {
  return withRedirect("/admin/publishers", async () => {
    const { user } = await actionAdmin();
    const id = uuid(formData, "listing_id");
    const note = text(formData, "note", "Where the figures came from", { min: 5, max: 300 });
    const m = { ...selfReportedMetrics(formData), spam_score: integer(formData, "spam_score", "Spam score", { min: 0, max: 100, optional: true }) };
    const db = createAdminClient();
    const { error } = await db.from("publisher_metrics").upsert({
      website_id: id, ...m, verified: true, verified_at: new Date().toISOString(), metrics_source: "admin_verified", verified_by: user.id, verification_note: note
    }, { onConflict: "website_id" });
    if (error) throw new ActionError("Could not save the verified figures.");
    await logAudit({ actorId: user.id, action: "metrics.verified", resourceType: "publisher_website", resourceId: id });
    revalidatePath("/admin/publishers"); revalidatePath("/publishers");
    redirect("/admin/publishers");
  });
}
