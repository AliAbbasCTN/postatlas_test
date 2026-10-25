import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/safe-fetch";
import { extractTitle, extractPageSignals, extractInternalLinks } from "@/lib/link-check";
import { calculateAuthorityGap } from "@/lib/opportunity";
import { getSeoProvider } from "@/lib/providers/seo-provider";
import { ActionError } from "@/lib/action-utils";

// Layers (each small, each testable on its own):
//   1. discoverUrls   - homepage, sitemap.xml and internal links
//   2. analyzePage    - observed technical facts for one page
//   3. link signals   - referring-domain data from the configured provider
//   4. opportunity    - calculateAuthorityGap() (pure, in lib/opportunity.ts)
// Publisher matching is a separate step (lib/matching.ts) triggered by the customer.

const MAX_PAGES = 20;
const DEADLINE_MS = 45_000;

export async function discoverUrls(domain: string): Promise<string[]> {
  const origin = `https://${domain}`;
  const urls = new Set<string>([`${origin}/`]);

  const sitemap = await safeFetch(`${origin}/sitemap.xml`, { accept: "application/xml,text/xml,text/plain", allowedTypes: /(xml|text\/plain)/, maxBytes: 1_000_000, timeoutMs: 6000 });
  if (sitemap.kind === "ok" && sitemap.status === 200) {
    for (const m of sitemap.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const u = new URL(m[1].replace(/&amp;/g, "&"));
        if (u.hostname.replace(/^www\./, "") === domain && !u.pathname.endsWith(".xml")) { u.hash = ""; urls.add(u.toString()); }
      } catch { /* ignore bad entries */ }
      if (urls.size >= MAX_PAGES) break;
    }
  }
  if (urls.size < MAX_PAGES) {
    const home = await safeFetch(`${origin}/`, { timeoutMs: 6000 });
    if (home.kind === "ok" && home.status === 200) {
      for (const l of extractInternalLinks(home.html, home.finalUrl, domain, MAX_PAGES)) { urls.add(l); if (urls.size >= MAX_PAGES) break; }
    }
  }
  return [...urls].slice(0, MAX_PAGES);
}

export async function analyzePage(url: string) {
  const out = await safeFetch(url, { timeoutMs: 6000 });
  if (out.kind !== "ok") return { url, http_status: null, title: null, noindex: null, canonical: null };
  const signals = out.status === 200 ? extractPageSignals(out.html, out.finalUrl) : null;
  return {
    url,
    http_status: out.status,
    title: out.status === 200 ? extractTitle(out.html) : null,
    noindex: signals ? signals.noindex : null,
    canonical: signals?.canonical ?? null
  };
}

export async function runAudit(website: { id: string; organization_id: string; domain: string; category: string }, actorId: string) {
  const db = createAdminClient();
  const { data: audit, error: insertError } = await db
    .from("audits")
    .insert({ website_id: website.id, organization_id: website.organization_id, requested_by: actorId, provider: getSeoProvider().name })
    .select("id").single();
  if (insertError) {
    if (insertError.code === "23505") throw new ActionError("An analysis is already running for this website.");
    console.error("[audit] insert", insertError.message);
    throw new ActionError("Could not start the analysis.");
  }

  const started = Date.now();
  try {
    const urls = await discoverUrls(website.domain);
    const pages: Awaited<ReturnType<typeof analyzePage>>[] = [];
    for (let i = 0; i < urls.length && Date.now() - started < DEADLINE_MS; i += 4) {
      pages.push(...(await Promise.all(urls.slice(i, i + 4).map(analyzePage))));
    }
    if (pages.length) await db.from("audit_pages").insert(pages.map((p) => ({ ...p, audit_id: audit.id, website_id: website.id })));

    // Link signals: only from a configured provider. Without one, nothing is estimated.
    const provider = getSeoProvider();
    let providerOk = false;
    if (provider.isConfigured()) {
      for (const p of pages.filter((x) => x.http_status === 200 && x.noindex !== true)) {
        if (Date.now() - started > DEADLINE_MS) break;
        const [own, ref] = await Promise.all([provider.getReferringDomains(p.url), provider.getCompetitiveReference(p.url)]);
        if (own.status !== "ok" || ref.status !== "ok") continue;
        providerOk = true;
        const calc = calculateAuthorityGap(own.value, ref.value.referringDomains);
        if (calc.kind !== "authority_gap") continue;
        await db.from("opportunities").upsert({
          website_id: website.id, organization_id: website.organization_id, audit_id: audit.id, page_url: p.url, page_title: p.title,
          category: website.category, kind: "authority_gap", level: calc.level,
          page_referring_domains: calc.pageReferringDomains, reference_referring_domains: calc.referenceReferringDomains, gap: calc.gap,
          est_links_min: calc.estimatedLinksMin, est_links_max: calc.estimatedLinksMax, data_source: own.source, data_fetched_at: own.fetchedAt
        }, { onConflict: "website_id,page_url" });
      }
    }

    const now = new Date().toISOString();
    await db.from("audits").update({ status: "COMPLETED", pages_found: pages.length, link_data_status: providerOk ? "ok" : "unavailable", completed_at: now }).eq("id", audit.id);
    await db.from("websites").update({ last_audit_at: now }).eq("id", website.id);
    return { auditId: audit.id as string, pages: pages.length, linkData: providerOk };
  } catch (e) {
    console.error("[audit] failed", e instanceof Error ? e.message : "unknown");
    await db.from("audits").update({ status: "FAILED", error: "The analysis could not be completed.", completed_at: new Date().toISOString() }).eq("id", audit.id);
    throw new ActionError("The analysis could not be completed. Please try again later.");
  }
}
