import { estimatePkr, formatUsd } from "@/lib/money";
import { freshnessLabel } from "@/lib/fx";
import type { UsdPkrRate } from "@/lib/services/fx";
import { fmtDateTime } from "@/components/ui";

// A USD list price with an illustrative PKR equivalent. The PKR line is an ESTIMATE from a stored, dated rate: it is
// labelled "not live" when old, and replaced by an honest message when no usable rate exists. It is never the amount due
// (the amount due is locked on the order at checkout).
export function PriceUsdPkr({ usd, rate, compact = false }: { usd: number | string | null | undefined; rate: UsdPkrRate | null; compact?: boolean }) {
  if (usd == null) return <span className="text-inksoft">-</span>;
  const u = Number(usd).toFixed(2);
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-mono">{formatUsd(u)}</span>
      {rate ? (
        <span className="text-xs text-inksoft" title={`${freshnessLabel(rate.freshness)} · ${rate.source} · ${fmtDateTime(rate.fetchedAt)}`}>≈ {estimatePkr(u, rate.rate)}{compact ? "" : rate.freshness === "live" ? "" : " (not live)"}</span>
      ) : (
        <span className="text-xs text-inksoft">PKR estimate temporarily unavailable</span>
      )}
    </span>
  );
}

export function RateNote({ rate }: { rate: UsdPkrRate | null }) {
  return (
    <p className="text-xs text-inksoft mt-4">
      {rate ? <>PKR amounts are estimates at 1 USD = {Number(rate.rate).toFixed(2)} PKR ({freshnessLabel(rate.freshness).toLowerCase()}, {rate.manual ? "set by PostAtlas" : rate.source}, {fmtDateTime(rate.fetchedAt)}). The amount you pay is locked when you place an order. </> : <>PKR estimates are temporarily unavailable. </>}
      {rate && !rate.manual ? <a className="underline" href="https://www.exchangerate-api.com" rel="noopener noreferrer">Rates By Exchange Rate API</a> : null}
    </p>
  );
}
