"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { text, oneOf } from "@/lib/validation";
import { NICHES } from "@/lib/niches";
import { normalizeDomain } from "@/lib/url-safety";
import { runSiteCheck } from "@/lib/services/site-check";
import { getSeoOverviewFor } from "@/lib/services/seo-overview";

const REUSE_HOURS = 6;

// PUBLIC by design: no account is needed to check a website. Protected by validation, a per-visitor and a
// global rate limit, a honeypot, a 6-hour result cache per site, and the SSRF-safe fetcher.
export async function startSiteCheck(formData: FormData) {
  return withRedirect("/check", async () => {
    if (String(formData.get("company_website_hp") ?? "")) redirect("/check"); // honeypot: bots fill hidden fields
    const domain = normalizeDomain(text(formData, "domain", "Website address", { max: 300 }));
    if (!domain) throw new ActionError("That does not look like a public website address. Try something like example.com.");
    const category = oneOf(formData, "category", "Topic", NICHES);

    const db = createAdminClient();
    const since = new Date(Date.now() - REUSE_HOURS * 3600_000).toISOString();
    const { data: recent } = await db.from("site_checks").select("id, result").eq("domain", domain).eq("category", category).gte("created_at", since).order("created_at", { ascending: false }).limit(3);
    // Only reuse a report that already has the current (technical) format; older ones are regenerated.
    const cached = (recent ?? []).find((r: { result: { technical?: unknown; reachable?: boolean } | null }) => r.result?.technical || r.result?.reachable === false);
    if (cached) redirect(`/check/${cached.id}`);

    await rateLimit(`sitecheck:ip:${await clientIp()}`, 3600, 8);
    await rateLimit("sitecheck:global", 3600, 400);

    // Technical checks (our own crawl) and third-party metrics (configured provider, if any) run side by side; a
    // provider problem only blanks its own sections.
    const [result, seo] = await Promise.all([runSiteCheck(domain, category), getSeoOverviewFor(domain)]);
    if (result.reachable) result.seo = seo;
    const { data, error } = await db.from("site_checks").insert({ domain, category, result }).select("id").single();
    if (error || !data) { console.error("[startSiteCheck]", error?.message); throw new ActionError("We could not save the report. Please try again."); }
    if (Math.random() < 0.02) await db.from("site_checks").delete().lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
    redirect(`/check/${data.id}`);
  });
}
