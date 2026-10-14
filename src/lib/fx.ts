// Exchange-rate rules (pure, unit-tested). The network call and storage live in services/fx.ts.
//
// Source: open.er-api.com (ExchangeRate-API "open access"), no key, daily update, caching permitted, attribution required.
// It is a market mid-rate, NOT a bank or exchange-house retail rate. Business policy below decides how it may be used.
import { parseRate, FX_SCALE } from "./money.ts";

export const FX_SOURCE_ID = "open.er-api.com";
export const FX_ATTRIBUTION = { text: "Rates By Exchange Rate API", href: "https://www.exchangerate-api.com" };

// USD->PKR has stayed between roughly 100 and 400 for years. Anything outside is treated as a bad response, not a rate.
export const PKR_MIN = 50;
export const PKR_MAX = 1000;

export type StoredRate = { rate: string; source: string; fetchedAt: string };

export type Freshness = "live" | "recent" | "stale" | "unusable";
export const POLICY = {
  /** Refresh when the cached rate is older than this. The provider itself updates once a day. */
  refreshAfterHours: 12,
  /** Up to this age the rate may be called "live" on screen. */
  liveMaxHours: 26,
  /** Up to this age it may still be SHOWN, labelled with its timestamp, as an estimate. */
  displayMaxHours: 24 * 7,
  /** Up to this age PKR checkout may lock a rate. Beyond it PKR checkout is refused until a fresh or manual rate exists. */
  checkoutMaxHours: 48
};

export function ageHours(fetchedAt: string, now = new Date()): number {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, (now.getTime() - t) / 3_600_000);
}

export function classifyFreshness(fetchedAt: string, now = new Date()): Freshness {
  const h = ageHours(fetchedAt, now);
  if (h <= POLICY.liveMaxHours) return "live";
  if (h <= POLICY.checkoutMaxHours) return "recent";
  if (h <= POLICY.displayMaxHours) return "stale";
  return "unusable";
}
export const mayDisplay = (f: Freshness) => f !== "unusable";
export const mayLockForCheckout = (fetchedAt: string, now = new Date()) => ageHours(fetchedAt, now) <= POLICY.checkoutMaxHours;
/** Minimum gap between ANY two provider fetches. The provider publishes once a day, so a fetch seconds after another adds nothing
 *  but a duplicate append-only row. Checked against the stored timestamp (shared by every server instance), not process memory. */
export const MIN_REFETCH_MINUTES = 10;
export const refetchTooSoon = (latestFetchedAt: string | null, now = new Date()) => !!latestFetchedAt && ageHours(latestFetchedAt, now) * 60 < MIN_REFETCH_MINUTES;
export const needsRefresh = (fetchedAt: string | null, now = new Date()) => !fetchedAt || ageHours(fetchedAt, now) >= POLICY.refreshAfterHours;

/** Validates the provider's JSON and returns a PKR-per-USD rate string, or throws. Never returns a guessed value. */
export function parseProviderResponse(body: unknown): { rate: string; providerUpdatedAt: string | null } {
  if (!body || typeof body !== "object") throw new Error("Invalid response");
  const o = body as Record<string, unknown>;
  if (o.result !== "success") throw new Error("Provider reported an error");
  if (o.base_code !== "USD") throw new Error("Unexpected base currency");
  const rates = o.rates as Record<string, unknown> | undefined;
  const pkr = rates?.PKR;
  if (typeof pkr !== "number" || !Number.isFinite(pkr)) throw new Error("No PKR rate in response");
  if (pkr < PKR_MIN || pkr > PKR_MAX) throw new Error("PKR rate outside the plausible range");
  const rate = parseRate(pkr.toFixed(6));
  const unix = o.time_last_update_unix;
  return { rate: `${rate / FX_SCALE}.${(rate % FX_SCALE).toString().padStart(6, "0")}`, providerUpdatedAt: typeof unix === "number" ? new Date(unix * 1000).toISOString() : null };
}

/** A manual rate set by an administrator must pass the same range check. */
export function validateManualRate(input: string): string {
  const r = parseRate(input);
  const n = Number(r) / Number(FX_SCALE);
  if (n < PKR_MIN || n > PKR_MAX) throw new Error("PKR rate outside the plausible range");
  return `${r / FX_SCALE}.${(r % FX_SCALE).toString().padStart(6, "0")}`;
}

export function freshnessLabel(f: Freshness): string {
  return f === "live" ? "Live rate" : f === "recent" ? "Recent rate" : f === "stale" ? "Stale rate (not live)" : "Unavailable";
}
