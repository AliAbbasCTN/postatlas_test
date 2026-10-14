import type { SeoOverview } from "./types.ts";

// Picks a previously stored overview worth reusing: same provider and at least one section that holds real data
// (never reuse a failure, so a transient outage is retried on the next check).
export function pickReusableOverview(candidates: (SeoOverview | null | undefined)[], providerId: string): SeoOverview | null {
  for (const c of candidates) {
    if (!c || c.provider !== providerId) continue;
    if (c.authority?.status === "ok" || c.organic?.status === "ok") return c;
  }
  return null;
}
