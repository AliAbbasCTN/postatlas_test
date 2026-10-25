// Opportunity classification. Inputs come from an SEO data provider and are
// "observed"; the level and link range are "calculated"/"estimated" and the
// UI labels them that way.

export type OpportunityLevel = "HIGH" | "MEDIUM" | "LOW";

export type OpportunityCalc =
  | { kind: "authority_gap"; level: OpportunityLevel; pageReferringDomains: number; referenceReferringDomains: number; gap: number; estimatedLinksMin: number; estimatedLinksMax: number }
  | { kind: "no_gap" };

export function calculateAuthorityGap(pageRd: number, refRd: number): OpportunityCalc {
  if (!Number.isFinite(pageRd) || !Number.isFinite(refRd) || pageRd < 0 || refRd <= 0) return { kind: "no_gap" };
  const gap = refRd - pageRd;
  const ratio = pageRd / refRd;
  let level: OpportunityLevel | null = null;
  if (ratio <= 0.35 && gap >= 5) level = "HIGH";
  else if (ratio <= 0.7 && gap >= 3) level = "MEDIUM";
  else if (ratio < 1 && gap >= 2) level = "LOW";
  if (!level) return { kind: "no_gap" };
  const min = Math.max(1, Math.round(gap * 0.1));
  const max = Math.min(10, Math.max(min, Math.round(gap * 0.25)));
  return { kind: "authority_gap", level, pageReferringDomains: pageRd, referenceReferringDomains: refRd, gap, estimatedLinksMin: min, estimatedLinksMax: max };
}

const LEVEL_ORDER: Record<OpportunityLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
export function compareOpportunities(a: { level: OpportunityLevel | null; gap: number | null }, b: { level: OpportunityLevel | null; gap: number | null }) {
  const la = a.level ? LEVEL_ORDER[a.level] : 3, lb = b.level ? LEVEL_ORDER[b.level] : 3;
  return la - lb || (b.gap ?? 0) - (a.gap ?? 0);
}
