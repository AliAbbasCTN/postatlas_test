// Provider-neutral shapes for third-party SEO data. The report UI only knows these types, so a provider can be
// swapped without touching it. Rules baked into the types:
//   - a value is either present with its provider and date, or UNAVAILABLE with a reason. There is no "0 by default".
//   - every number a provider gives is labelled index data or an estimate; none is presented as observed by PostAtlas.

export type UnavailableReason = "no_provider" | "plan_or_key" | "rate_limited" | "timeout" | "provider_error" | "not_supported" | "no_data" | "budget";

export type Section<T> =
  | { status: "ok"; value: T; provider: string; asOf: string }
  | { status: "unavailable"; reason: UnavailableReason; message: string };

export type HistoryPoint = { date: string; value: number };

export type AuthorityData = {
  /** Provider's own domain-strength score (e.g. Ahrefs "Domain Rating"). Domain-level. Null if the provider did not return it. */
  domainRating: number | null;
  domainRatingLabel: string;
  /** True when only Domain Rating is available (the free Ahrefs endpoint): backlink counts, history, traffic and keywords need a paid plan. */
  drOnly?: boolean;
  referringDomains: { live: number | null; allTime: number | null };
  backlinks: { live: number | null; allTime: number | null };
  refDomainsHistory: HistoryPoint[];
  domainRatingHistory: HistoryPoint[];
};

export type OrganicData = {
  estimatedTraffic: number | null;       // monthly, ESTIMATE
  estimatedKeywords: number | null;      // ESTIMATE
  trafficHistory: HistoryPoint[];        // monthly, ESTIMATE
  countries: { country: string; traffic: number | null; keywords: number | null; share: number | null }[];
  topPages: { url: string; traffic: number | null; keywords: number | null; topKeyword: string | null }[];
  topKeywords: { keyword: string; position: number | null; volume: number | null; traffic: number | null; url: string | null }[];
};

export type GapOpportunity = {
  domain: string;
  domainRating: number | null;
  linksToCompetitor: number | null;
};
export type GapData = {
  competitor: string;
  note: string;
  opportunities: GapOpportunity[];
};

export type SeoOverview = {
  provider: string;            // id, e.g. "ahrefs" or "none"
  providerLabel: string;
  fetchedAt: string;
  authority: Section<AuthorityData>;
  organic: Section<OrganicData>;
  gap: Section<GapData>;
};

export interface SeoOverviewProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  fetchOverview(domain: string): Promise<SeoOverview>;
}

export function unavailableOverview(id: string, label: string, reason: UnavailableReason, message: string, now = new Date()): SeoOverview {
  const u = { status: "unavailable", reason, message } as const;
  return { provider: id, providerLabel: label, fetchedAt: now.toISOString(), authority: u, organic: u, gap: u };
}
