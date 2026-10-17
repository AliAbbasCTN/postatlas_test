// Pure rules for site reviews (unit-tested). The database enforces the same rules in submit_site_review().
import type { OrderStatus } from "./types.ts";

export const MIN_RATING = 1, MAX_RATING = 5, MAX_COMMENT = 1500, MIN_COMMENT = 3;

/** A placement can be reviewed once it was delivered AND verified. Anything earlier (or disputed / cancelled) cannot. */
export const REVIEWABLE_STATUSES: readonly OrderStatus[] = ["VERIFIED", "MONITORING", "COMPLETED"];

export function canReviewOrder(o: { status: string; hasVerifiedPlacement: boolean; alreadyReviewed: boolean }): { ok: true } | { ok: false; reason: string } {
  if (o.alreadyReviewed) return { ok: false, reason: "This order has already been reviewed." };
  if (!(REVIEWABLE_STATUSES as readonly string[]).includes(o.status) || !o.hasVerifiedPlacement) {
    return { ok: false, reason: "You can review a website once your placement has been published and verified." };
  }
  return { ok: true };
}

export function parseRating(raw: unknown): number | null {
  const n = typeof raw === "string" && /^[1-5]$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) ? n : null;
}

export type RatingSummary = { count: number; average: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number> };
export function summarizeRatings(ratings: number[]): RatingSummary {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as RatingSummary["distribution"];
  let sum = 0, count = 0;
  for (const r of ratings) {
    if (!Number.isInteger(r) || r < MIN_RATING || r > MAX_RATING) continue;
    distribution[r as 1 | 2 | 3 | 4 | 5]++; sum += r; count++;
  }
  return { count, average: count ? Math.round((sum / count) * 100) / 100 : null, distribution };
}

/** "4.5 out of 5 (12 reviews)" - plain text, so it can be read aloud and is never colour-only. */
export function ratingText(average: number | null, count: number): string {
  if (!count || average == null) return "No reviews yet";
  return `${average.toFixed(1)} out of 5 (${count} review${count === 1 ? "" : "s"})`;
}
