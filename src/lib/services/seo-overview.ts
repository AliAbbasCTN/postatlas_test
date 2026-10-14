import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { getSeoOverviewProvider } from "@/lib/seo/provider";
import { unavailableOverview, type SeoOverview } from "@/lib/seo/types";
import { pickReusableOverview } from "@/lib/seo/reuse";

// Third-party SEO data for a domain, with three protections for the (paid, rate-limited) provider:
//   1. reuse: a recent report for the same domain that already holds real provider data is reused as-is (its original
//      fetch date is kept, so freshness is never overstated). SEO_CACHE_HOURS, default 72.
//   2. budget: a global daily cap on provider lookups (SEO_PROVIDER_DAILY_BUDGET, default 150).
//   3. failure isolation: any provider problem becomes an "unavailable" section with a reason; the technical report
//      is unaffected.
export async function getSeoOverviewFor(domain: string): Promise<SeoOverview> {
  const provider = getSeoOverviewProvider();
  if (!provider.isConfigured()) return provider.fetchOverview(domain);

  const hours = Math.min(720, Math.max(1, Number(process.env.SEO_CACHE_HOURS) || 72));
  try {
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data } = await createAdminClient().from("site_checks").select("result").eq("domain", domain).gte("created_at", since).order("created_at", { ascending: false }).limit(5);
    const reuse = pickReusableOverview((data ?? []).map((r: { result: unknown }) => (r.result as { seo?: SeoOverview } | null)?.seo), provider.id);
    if (reuse) return reuse;
  } catch (e) { console.error("[seo-overview] reuse lookup", e instanceof Error ? e.message : "unknown"); }

  const budget = Math.max(1, Number(process.env.SEO_PROVIDER_DAILY_BUDGET) || 150);
  try { await rateLimit("seo:provider:day", 86400, budget); }
  catch { return unavailableOverview(provider.id, provider.label, "budget", "The daily limit for third-party SEO lookups has been reached. Technical results are still shown; try again later."); }

  try { return await provider.fetchOverview(domain); }
  catch (e) {
    console.error("[seo-overview] provider", e instanceof Error ? e.message : "unknown");
    return unavailableOverview(provider.id, provider.label, "provider_error", "The data provider could not be reached.");
  }
}
