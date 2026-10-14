// Explainable publisher matching. Every point of score has a plain-language
// reason, and publisher metrics only count when an administrator verified them.

export type MatchOpportunity = {
  category: string | null;
  country?: string | null;
  maxPrice?: number | null;
};

export type MatchCandidate = {
  websiteId: string;
  domain: string;
  niche: string | null;
  country: string | null;
  priceGuestPost: number | null;
  priceLinkInsertion: number | null;
  turnaroundMin: number | null;
  turnaroundMax: number | null;
  linkType: "dofollow" | "nofollow" | "mixed" | null;
  metrics: { dr: number | null; organicTraffic: number | null; verified: boolean } | null;
};

export type MatchResult = {
  websiteId: string;
  score: number;            // 0-100, only meaningful for ordering within one result list
  reasons: string[];        // why it was recommended
  cautions: string[];       // what the customer should know
  excluded?: string;        // present when the candidate cannot be offered at all
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function tokens(s: string | null | undefined): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && t !== "and"));
}

export function categoryRelevance(oppCategory: string | null, niche: string | null): "exact" | "partial" | "none" | "unknown" {
  if (!oppCategory || !niche) return "unknown";
  if (norm(oppCategory) === norm(niche)) return "exact";
  const a = tokens(oppCategory), b = tokens(niche);
  for (const t of a) if (b.has(t)) return "partial";
  return "none";
}

export function matchPublisher(opp: MatchOpportunity, c: MatchCandidate): MatchResult {
  const reasons: string[] = [];
  const cautions: string[] = [];
  let score = 0;

  const rel = categoryRelevance(opp.category, c.niche);
  if (rel === "exact") { score += 40; reasons.push(`Its topic (${c.niche}) matches your page topic.`); }
  else if (rel === "partial") { score += 20; reasons.push(`Its topic (${c.niche}) overlaps with your page topic.`); }
  else if (rel === "none") { cautions.push(`Its topic (${c.niche}) is different from your page topic.`); }
  else cautions.push("We could not compare topics because one side has no category.");

  if (opp.country && c.country) {
    if (norm(opp.country) === norm(c.country)) { score += 10; reasons.push(`It serves the same country (${c.country}).`); }
  }

  if (c.linkType === "dofollow") { score += 10; reasons.push("Links are published as dofollow."); }
  else if (c.linkType === "nofollow") cautions.push("Links on this site are nofollow.");
  else if (c.linkType === "mixed") cautions.push("The link type varies by placement - confirm before ordering.");
  else cautions.push("The publisher has not stated a link type.");

  if (c.metrics?.verified) {
    const dr = c.metrics.dr;
    if (dr != null) { score += Math.min(25, Math.round((dr / 100) * 25)); reasons.push(`Verified authority score: ${dr}.`); }
    const t = c.metrics.organicTraffic;
    if (t != null) { score += Math.min(10, Math.round(Math.log10(Math.max(t, 1)) * 2)); reasons.push(`Verified organic traffic: ${t.toLocaleString("en-US")} visits/month.`); }
  } else {
    cautions.push("Authority and traffic figures are reported by the publisher and have not been verified by PostAtlas.");
  }

  const price = c.priceGuestPost ?? c.priceLinkInsertion;
  if (price == null) {
    cautions.push("No price is listed.");
  } else if (opp.maxPrice != null) {
    if (price <= opp.maxPrice) { score += 5; reasons.push("It fits your budget."); }
    else cautions.push("It is above your stated budget.");
  }

  if (c.turnaroundMax != null) {
    if (c.turnaroundMax <= 7) { score += 5; reasons.push(`Typical turnaround is ${c.turnaroundMax} days or less.`); }
  }

  // An unrelated topic is never recommended just because other factors look good.
  if (rel === "none") return { websiteId: c.websiteId, score: 0, reasons, cautions, excluded: "topic_mismatch" };

  return { websiteId: c.websiteId, score: Math.max(0, Math.min(100, score)), reasons, cautions };
}

export function rankPublishers(opp: MatchOpportunity, candidates: MatchCandidate[], limit = 20) {
  return candidates
    .map((c) => ({ candidate: c, match: matchPublisher(opp, c) }))
    .filter((r) => !r.match.excluded)
    .sort((a, b) => b.match.score - a.match.score || a.candidate.domain.localeCompare(b.candidate.domain))
    .slice(0, limit);
}

export function explainMatch(m: MatchResult): string {
  if (m.reasons.length === 0) return "A relevant placement option based on the information currently available.";
  return "Recommended because " + m.reasons.slice(0, 3).map((r) => r.charAt(0).toLowerCase() + r.slice(1).replace(/\.$/, "")).join(", and ") + ".";
}
