// Ahrefs API v3 adapter (https://docs.ahrefs.com/reference). Requires a paid Ahrefs plan with API v3 access and
// consumes API units; the key stays on the server. Endpoints used (all under https://api.ahrefs.com/v3/site-explorer):
//   domain-rating, backlinks-stats, refdomains-history, domain-rating-history,
//   metrics, metrics-history, metrics-by-country, organic-keywords, top-pages, organic-competitors, refdomains.
// Parsing is defensive: a missing or wrongly typed field becomes null/omitted, never 0.
// NOTE: response field names were written from the published v3 reference and exercised only against fixtures in
// tests/seo-provider.test.ts. Confirm against a live key (see docs/SEO_DATA.md) before relying on it.
import type { AuthorityData, GapData, HistoryPoint, OrganicData, Section, SeoOverview, SeoOverviewProvider, UnavailableReason } from "./types.ts";
import { unavailableOverview } from "./types.ts";

const BASE = "https://api.ahrefs.com/v3/site-explorer";
export const AHREFS_TIMEOUT_MS = 12_000;

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

class ProviderFailure extends Error {
  reason: UnavailableReason;
  constructor(reason: UnavailableReason, message: string) { super(message); this.reason = reason; }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function mapHistory(rows: unknown, valueKey: string, max = 24): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const r of arr(rows)) {
    const o = rec(r); const date = str(o.date); const value = num(o[valueKey]);
    if (date && value !== null) out.push({ date: date.slice(0, 10), value });
  }
  return out.slice(-max);
}

export function createAhrefsProvider(cfg: { apiKey: string | undefined; fetchImpl?: FetchLike; now?: () => Date; timeoutMs?: number }): SeoOverviewProvider {
  const now = cfg.now ?? (() => new Date());
  const doFetch: FetchLike = cfg.fetchImpl ?? ((url, init) => fetch(url, { headers: init.headers, signal: init.signal, cache: "no-store" }) as ReturnType<FetchLike>);

  async function call(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    if (!cfg.apiKey) throw new ProviderFailure("no_provider", "No API key configured.");
    const url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? AHREFS_TIMEOUT_MS);
    try {
      const res = await doFetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" }, signal: ctl.signal });
      if (res.status === 429) throw new ProviderFailure("rate_limited", "The data provider is rate limiting requests.");
      if (res.status === 401 || res.status === 403) throw new ProviderFailure("plan_or_key", "The data provider rejected the API key or the plan does not include this data.");
      if (!res.ok) throw new ProviderFailure("provider_error", `The data provider returned HTTP ${res.status}.`);
      return rec(await res.json());
    } catch (e) {
      if (e instanceof ProviderFailure) throw e;
      if (e instanceof Error && e.name === "AbortError") throw new ProviderFailure("timeout", "The data provider did not answer in time.");
      throw new ProviderFailure("provider_error", "The data provider could not be reached.");
    } finally { clearTimeout(timer); }
  }

  const failure = (e: unknown): Section<never> => {
    const f = e instanceof ProviderFailure ? e : new ProviderFailure("provider_error", "The data provider failed.");
    return { status: "unavailable", reason: f.reason, message: f.message };
  };

  async function authority(domain: string, today: string, asOf: string): Promise<Section<AuthorityData>> {
    const from = isoDay(new Date(now().getTime() - 365 * 86400_000));
    try {
      const [dr, bl, rdh, drh] = await Promise.allSettled([
        call("domain-rating", { target: domain, date: today }),
        call("backlinks-stats", { target: domain, date: today, mode: "subdomains" }),
        call("refdomains-history", { target: domain, date_from: from, history_grouping: "monthly" }),
        call("domain-rating-history", { target: domain, date_from: from, history_grouping: "monthly" })
      ]);
      // If the two core calls both failed, report why instead of an empty card.
      if (dr.status === "rejected" && bl.status === "rejected") throw dr.reason;
      const drObj = dr.status === "fulfilled" ? rec(rec(dr.value).domain_rating) : {};
      const blObj = bl.status === "fulfilled" ? rec(rec(bl.value).metrics) : {};
      const value: AuthorityData = {
        domainRating: num(drObj.domain_rating),
        domainRatingLabel: "Domain Rating (Ahrefs)",
        referringDomains: { live: num(blObj.live_refdomains), allTime: num(blObj.all_time_refdomains) },
        backlinks: { live: num(blObj.live), allTime: num(blObj.all_time) },
        refDomainsHistory: rdh.status === "fulfilled" ? mapHistory(rec(rdh.value).refdomains, "refdomains") : [],
        domainRatingHistory: drh.status === "fulfilled" ? mapHistory(rec(drh.value).domain_ratings, "domain_rating") : []
      };
      const anything = value.domainRating !== null || value.referringDomains.live !== null || value.backlinks.live !== null;
      if (!anything) return { status: "unavailable", reason: "no_data", message: "The provider has no backlink data for this domain." };
      return { status: "ok", value, provider: "ahrefs", asOf };
    } catch (e) { return failure(e); }
  }

  async function organic(domain: string, today: string, asOf: string): Promise<Section<OrganicData>> {
    const from = isoDay(new Date(now().getTime() - 365 * 86400_000));
    try {
      const [m, hist, byCountry, pages, kws] = await Promise.allSettled([
        call("metrics", { target: domain, date: today, mode: "subdomains" }),
        call("metrics-history", { target: domain, date_from: from, history_grouping: "monthly", select: "date,org_traffic" }),
        call("metrics-by-country", { target: domain, date: today, mode: "subdomains", select: "country,org_traffic,org_keywords", limit: "50" }),
        call("top-pages", { target: domain, date: today, mode: "subdomains", select: "url,sum_traffic,keywords,top_keyword", order_by: "sum_traffic:desc", limit: "10" }),
        call("organic-keywords", { target: domain, date: today, mode: "subdomains", select: "keyword,best_position,volume,sum_traffic,best_position_url", order_by: "sum_traffic:desc", limit: "15" })
      ]);
      if (m.status === "rejected" && byCountry.status === "rejected" && pages.status === "rejected") throw m.reason;
      const mo = m.status === "fulfilled" ? rec(rec(m.value).metrics) : {};
      const rows = byCountry.status === "fulfilled" ? arr(rec(byCountry.value).metrics) : [];
      const total = rows.reduce<number>((s, r) => s + (num(rec(r).org_traffic) ?? 0), 0);
      const countries = rows.map((r) => {
        const o = rec(r); const traffic = num(o.org_traffic);
        return { country: (str(o.country) ?? "").toUpperCase(), traffic, keywords: num(o.org_keywords), share: traffic !== null && total > 0 ? traffic / total : null };
      }).filter((c) => c.country && (c.traffic ?? 0) > 0).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).slice(0, 12);
      const value: OrganicData = {
        estimatedTraffic: num(mo.org_traffic), estimatedKeywords: num(mo.org_keywords),
        trafficHistory: hist.status === "fulfilled" ? mapHistory(rec(hist.value).metrics, "org_traffic") : [],
        countries,
        topPages: pages.status === "fulfilled" ? arr(rec(pages.value).pages).map((p) => { const o = rec(p); return { url: str(o.url) ?? "", traffic: num(o.sum_traffic), keywords: num(o.keywords), topKeyword: str(o.top_keyword) }; }).filter((p) => p.url).slice(0, 10) : [],
        topKeywords: kws.status === "fulfilled" ? arr(rec(kws.value).keywords).map((k) => { const o = rec(k); return { keyword: str(o.keyword) ?? "", position: num(o.best_position), volume: num(o.volume), traffic: num(o.sum_traffic), url: str(o.best_position_url) }; }).filter((k) => k.keyword).slice(0, 15) : []
      };
      if (value.estimatedTraffic === null && value.estimatedKeywords === null && value.countries.length === 0 && value.topPages.length === 0 && value.topKeywords.length === 0) {
        return { status: "unavailable", reason: "no_data", message: "The provider has no organic search data for this domain." };
      }
      return { status: "ok", value, provider: "ahrefs", asOf };
    } catch (e) { return failure(e); }
  }

  // Backlink gap = domains that link to the closest organic competitor but not to this site. CALCULATED here from two
  // provider lists (competitor: top 100 by DR; this site: up to 1000), so it is a sample, and says so.
  async function gap(domain: string, today: string, asOf: string): Promise<Section<GapData>> {
    try {
      const comp = await call("organic-competitors", { target: domain, date: today, mode: "subdomains", country: "us", select: "competitor_domain,keywords_common", order_by: "keywords_common:desc", limit: "3" });
      const competitor = arr(comp.competitors).map((c) => str(rec(c).competitor_domain)).find((d) => d && d !== domain) ?? null;
      if (!competitor) return { status: "unavailable", reason: "no_data", message: "The provider found no organic competitor to compare against." };
      const [theirs, mine] = await Promise.all([
        call("refdomains", { target: competitor, mode: "subdomains", select: "domain,domain_rating,dofollow_links,links_to_target", order_by: "domain_rating:desc", limit: "100", history: "live" }),
        call("refdomains", { target: domain, mode: "subdomains", select: "domain", limit: "1000", history: "live" })
      ]);
      const have = new Set(arr(mine.refdomains).map((r) => str(rec(r).domain)).filter((d): d is string => !!d));
      const opportunities = arr(theirs.refdomains).map((r) => { const o = rec(r); return { domain: str(o.domain) ?? "", domainRating: num(o.domain_rating), linksToCompetitor: num(o.links_to_target) }; })
        .filter((o) => o.domain && !have.has(o.domain) && o.domain !== domain).slice(0, 25);
      if (opportunities.length === 0) return { status: "unavailable", reason: "no_data", message: "No missing referring domains were found in the compared sample." };
      return { status: "ok", asOf, provider: "ahrefs", value: { competitor, opportunities, note: "Calculated from provider data: the competitor's top 100 referring domains by Domain Rating that were not among your first 1,000 referring domains. A sample, not a complete gap report." } };
    } catch (e) { return failure(e); }
  }

  return {
    id: "ahrefs", label: "Ahrefs",
    isConfigured: () => !!cfg.apiKey,
    async fetchOverview(domain) {
      if (!cfg.apiKey) return unavailableOverview("ahrefs", "Ahrefs", "no_provider", "No Ahrefs API key is configured.", now());
      const t = now(); const today = isoDay(t); const asOf = t.toISOString();
      const [a, o, g] = await Promise.all([authority(domain, today, asOf), organic(domain, today, asOf), gap(domain, today, asOf)]);
      return { provider: "ahrefs", providerLabel: "Ahrefs", fetchedAt: asOf, authority: a, organic: o, gap: g } satisfies SeoOverview;
    }
  };
}
