// Pure helpers for showing Ahrefs Domain Rating (DR). No imports, so tests can run it directly.
// DR is a 0-100 score of a domain's backlink profile relative to other domains in Ahrefs' index. It is NOT a Google ranking factor,
// and the wording below never says otherwise.
export const DR_LICENSE_URL = "https://ahrefs.com/legal/domain-rating-license";
export const DR_ATTRIBUTION = "Domain Rating by Ahrefs";

export const clampDr = (v: number): number => Math.min(100, Math.max(0, v));

export type DrBand = { key: "very-low" | "low" | "moderate" | "strong" | "very-strong"; label: string; text: string };

/** Descriptive bands for the ring colour and caption. They describe the scale, not a promise about rankings. */
export function drBand(dr: number): DrBand {
  const v = clampDr(dr);
  if (v < 20) return { key: "very-low", label: "Very low", text: "text-redsig" };
  if (v < 40) return { key: "low", label: "Low", text: "text-amber" };
  if (v < 60) return { key: "moderate", label: "Moderate", text: "text-verdigris" };
  if (v < 80) return { key: "strong", label: "Strong", text: "text-verdigris" };
  return { key: "very-strong", label: "Very strong", text: "text-navy" };
}

/** Geometry for the SVG ring: the visible arc is `dr` percent of the circle, starting at 12 o'clock. */
export function drRing(dr: number, radius = 52): { circumference: number; dash: number; gap: number } {
  const circumference = 2 * Math.PI * radius;
  const dash = (clampDr(dr) / 100) * circumference;
  return { circumference, dash, gap: circumference - dash };
}
