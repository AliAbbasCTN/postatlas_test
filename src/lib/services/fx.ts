import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { FX_SOURCE_ID, classifyFreshness, refetchTooSoon, mayLockForCheckout, needsRefresh, parseProviderResponse, validateManualRate, type Freshness } from "@/lib/fx";

// USD -> PKR. Stored (append-only) in fx_rates. A rate is fetched at most every 12 hours, never on a page load unless
// the cached one is older than that, and a failure never invents a value: callers get the last stored rate with its
// real age, or null.
export type UsdPkrRate = { rate: string; source: string; fetchedAt: string; manual: boolean; freshness: Freshness; checkoutAllowed: boolean };

function endpoint(): string {
  const k = process.env.FX_API_KEY?.trim();
  return k ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(k)}/latest/USD` : "https://open.er-api.com/v6/latest/USD";
}

async function latestStored(): Promise<{ rate: string; source: string; fetched_at: string; manual: boolean } | null> {
  const { data } = await createAdminClient().from("fx_rates").select("rate, source, fetched_at, manual").eq("quote", "PKR").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { rate: String(data.rate), source: data.source, fetched_at: data.fetched_at, manual: data.manual } : null;
}

export async function refreshUsdPkr(): Promise<{ ok: boolean; message: string }> {
  try {
    // Duplicate-refresh guard (cron + admin click + several serverless instances). fx_rates stays append-only; we just do not append twice.
    const latest = await latestStored();
    if (refetchTooSoon(latest?.fetched_at ?? null)) return { ok: true, message: "The exchange rate was refreshed moments ago, so it is already up to date." };
    const res = await fetch(endpoint(), { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (res.status === 429) return { ok: false, message: "Rate provider is rate limiting us" };
    if (!res.ok) return { ok: false, message: `Rate provider returned HTTP ${res.status}` };
    const parsed = parseProviderResponse(await res.json());
    const { error } = await createAdminClient().from("fx_rates").insert({
      quote: "PKR", rate: parsed.rate, source: process.env.FX_API_KEY ? "exchangerate-api.com" : FX_SOURCE_ID, provider_updated_at: parsed.providerUpdatedAt
    });
    if (error) return { ok: false, message: "Could not store the rate" };
    return { ok: true, message: "Rate refreshed" };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.name === "TimeoutError" ? "Rate provider timed out" : "Rate provider unavailable or returned an invalid response" };
  }
}

let lastAttempt = 0;   // per server instance: never retry a failing provider more than once every 10 minutes

/** Returns the stored rate (refreshing first when it is older than 12h). null = no usable rate; the UI says so. */
export async function getUsdPkr(opts: { refresh?: boolean } = {}): Promise<UsdPkrRate | null> {
  let row = await latestStored();
  if ((opts.refresh ?? true) && needsRefresh(row?.fetched_at ?? null) && Date.now() - lastAttempt > 10 * 60_000) {
    lastAttempt = Date.now();
    const r = await refreshUsdPkr();
    if (!r.ok) console.error("[fx] refresh failed:", r.message);
    row = await latestStored();
  }
  if (!row) return null;
  const freshness = classifyFreshness(row.fetched_at);
  if (freshness === "unusable") return null;
  return { rate: row.rate, source: row.source, fetchedAt: row.fetched_at, manual: row.manual, freshness, checkoutAllowed: mayLockForCheckout(row.fetched_at) };
}

export async function setManualUsdPkr(rate: string, adminId: string, note: string): Promise<void> {
  const valid = validateManualRate(rate);
  const { error } = await createAdminClient().from("fx_rates").insert({ quote: "PKR", rate: valid, source: `manual: ${note.slice(0, 60)}`, manual: true, set_by: adminId });
  if (error) throw new Error("Could not store the rate");
}
