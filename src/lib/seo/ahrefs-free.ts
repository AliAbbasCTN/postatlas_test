// Client for Ahrefs' FREE Domain Rating endpoint (https://docs.ahrefs.com/en/api/reference/public/get-domain-rating-free):
//   GET https://api.ahrefs.com/v3/public/domain-rating-free?target=<domain>&version=dr3&output=json
//   Authorization: Bearer <free APIv3 key>      (create one in your Ahrefs account: Account settings > API keys)
//   -> { "domain_rating": { "domain_rating": 46.0, "license": "..." } }
// It costs no API units, works for ANY domain and needs no paid plan. That is different from /v3/site-explorer/domain-rating,
// which a free key may only call for ahrefs.com, yep.com and firehose.com (any other domain answers 403).
// Licence: the number may be shown only with the attribution "Domain Rating by Ahrefs" linking to https://ahrefs.com/ (see dr.ts).
// The key stays on the server. A missing, wrongly typed or out-of-range value becomes "no_data", never 0.
import type { AuthorityData, Section } from "./types.ts";

export const AHREFS_FREE_URL = "https://api.ahrefs.com/v3/public/domain-rating-free";
export const AHREFS_FREE_TIMEOUT_MS = 10_000;

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function freeAuthority(domainRating: number, asOf: string): Section<AuthorityData> {
  return {
    status: "ok", provider: "ahrefs", asOf,
    value: {
      domainRating, domainRatingLabel: "Domain Rating", drOnly: true,
      referringDomains: { live: null, allTime: null }, backlinks: { live: null, allTime: null },
      refDomainsHistory: [], domainRatingHistory: []
    }
  };
}

export async function fetchFreeDomainRating(domain: string, cfg: { apiKey: string | undefined; fetchImpl?: FetchLike; now?: () => Date; timeoutMs?: number }): Promise<Section<AuthorityData>> {
  if (!cfg.apiKey) return { status: "unavailable", reason: "no_provider", message: "No Ahrefs API key is configured." };
  const now = cfg.now ?? (() => new Date());
  const doFetch: FetchLike = cfg.fetchImpl ?? ((url, init) => fetch(url, { headers: init.headers, signal: init.signal, cache: "no-store" }) as ReturnType<FetchLike>);
  const url = `${AHREFS_FREE_URL}?${new URLSearchParams({ target: domain, version: "dr3", output: "json" }).toString()}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? AHREFS_FREE_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" }, signal: ctl.signal });
    if (res.status === 429) return { status: "unavailable", reason: "rate_limited", message: "Ahrefs is rate limiting requests (about 60 per minute). Try again in a minute." };
    if (res.status === 401 || res.status === 403) return { status: "unavailable", reason: "plan_or_key", message: "Ahrefs rejected the API key. Create a free key in your Ahrefs account (Account settings, API keys) and add it to your server environment settings." };
    if (!res.ok) return { status: "unavailable", reason: "provider_error", message: `Ahrefs returned HTTP ${res.status}.` };
    const dr = rec(rec(await res.json()).domain_rating).domain_rating;
    if (typeof dr !== "number" || !Number.isFinite(dr) || dr < 0 || dr > 100) return { status: "unavailable", reason: "no_data", message: "Ahrefs returned no Domain Rating for this domain." };
    return freeAuthority(dr, now().toISOString());
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { status: "unavailable", reason: "timeout", message: "Ahrefs did not answer in time." };
    return { status: "unavailable", reason: "provider_error", message: "Ahrefs could not be reached." };
  } finally { clearTimeout(timer); }
}
