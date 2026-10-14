import type { MatchCandidate } from "./matching.ts";

// Columns the matcher needs from publisher_websites (+ embedded metrics). Only approved rows are ever queried.
export const MATCH_SELECT = "id, domain, niche, country, price_guest_post, price_link_insertion, turnaround_days_min, turnaround_days_max, link_type, indexed_status, publisher_metrics(dr, organic_traffic, verified)";

export function toCandidates(rows: any[]): MatchCandidate[] {
  return (rows ?? []).map((w) => {
    const m = Array.isArray(w.publisher_metrics) ? w.publisher_metrics[0] : w.publisher_metrics;
    return {
      websiteId: w.id, domain: w.domain, niche: w.niche, country: w.country,
      priceGuestPost: w.price_guest_post == null ? null : Number(w.price_guest_post),
      priceLinkInsertion: w.price_link_insertion == null ? null : Number(w.price_link_insertion),
      turnaroundMin: w.turnaround_days_min, turnaroundMax: w.turnaround_days_max, linkType: w.link_type,
      metrics: m ? { dr: m.dr, organicTraffic: m.organic_traffic == null ? null : Number(m.organic_traffic), verified: !!m.verified } : null
    };
  });
}
