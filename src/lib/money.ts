// Decimal-safe money arithmetic for PostAtlas. Nothing here uses floating point for money: amounts are integers in
// minor units (USD cents) and rates are scaled integers, so $0.10 + $0.20 is exactly $0.30 and rounding is explicit.
//
// OFFICIAL PRICING MODEL (the only place these numbers are calculated; the database re-checks them with CHECK constraints)
//   * USD is the canonical currency. A publisher's list price is in USD.
//   * The customer pays the list price. There is NO customer markup, tax or processing fee.
//   * PostAtlas commission = 2% (200 basis points) of the USD list price, deducted from the PUBLISHER's side.
//   * Publisher net entitlement = list price - commission (so the two always add up to the list price exactly).
//   * Rounding: commission is rounded half-up to the cent. PKR checkout amounts are rounded half-up to a whole rupee.
//   * Commission is NEVER computed from a converted amount.

export const COMMISSION_BPS = 200;                 // 2.00%
export const FX_SCALE = 1_000_000n;                // rates are stored with 6 decimal places

export type Currency = "USD" | "PKR";

/** "100", "100.5", "100.50" -> 10050n cents. Rejects anything that is not a plain non-negative decimal with <= 2 places. */
export function usdToMinor(input: string | number): bigint {
  const s = typeof input === "number" ? input.toFixed(2) : input.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new Error("Invalid USD amount");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

export function minorToDecimalString(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  return `${neg ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Integer division rounding half up (for non-negative values). */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error("divRoundHalfUp expects n >= 0 and d > 0");
  return (n * 2n + d) / (d * 2n);
}

export type PriceBreakdown = {
  listPriceMinor: bigint;
  customerBaseMinor: bigint;      // equals the list price: no markup
  commissionMinor: bigint;
  publisherNetMinor: bigint;
  commissionBps: number;
};

export function priceBreakdown(listPriceUsd: string | number, commissionBps = COMMISSION_BPS): PriceBreakdown {
  const list = usdToMinor(listPriceUsd);
  if (list <= 0n) throw new Error("List price must be positive");
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 5000) throw new Error("Invalid commission");
  const commission = divRoundHalfUp(list * BigInt(commissionBps), 10_000n);
  return { listPriceMinor: list, customerBaseMinor: list, commissionMinor: commission, publisherNetMinor: list - commission, commissionBps };
}

/** "278.5" or "278.500000" -> 278500000n. At most 6 decimals, positive, bounded to a sane range. */
export function parseRate(input: string | number): bigint {
  const s = typeof input === "number" ? input.toFixed(6) : input.trim();
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s)) throw new Error("Invalid exchange rate");
  const [whole, frac = ""] = s.split(".");
  const r = BigInt(whole) * FX_SCALE + BigInt(frac.padEnd(6, "0"));
  if (r <= 0n) throw new Error("Exchange rate must be positive");
  return r;
}
export const rateToString = (r: bigint) => `${r / FX_SCALE}.${(r % FX_SCALE).toString().padStart(6, "0")}`;

/** USD cents x (PKR per USD) -> whole rupees, rounded half up. */
export function usdMinorToPkrWhole(usdMinor: bigint, rate: bigint): bigint {
  return divRoundHalfUp(usdMinor * rate, 100n * FX_SCALE);
}

export type CheckoutAmount = { currency: Currency; amountDue: string; fxRate: string | null };

/** What the customer must pay, from the USD list price. PKR needs an explicit, validated rate. */
export function checkoutAmount(listPriceUsd: string | number, currency: Currency, rate?: string | number | null): CheckoutAmount {
  const list = usdToMinor(listPriceUsd);
  if (currency === "USD") return { currency, amountDue: minorToDecimalString(list), fxRate: null };
  if (rate === undefined || rate === null) throw new Error("An exchange rate is required for PKR checkout");
  const r = parseRate(rate);
  return { currency, amountDue: `${usdMinorToPkrWhole(list, r)}.00`, fxRate: rateToString(r) };
}

// ---- display -------------------------------------------------------------------------------------------------

export function formatUsd(amount: string | number): string {
  const minor = usdToMinor(amount);
  return `$${(minor / 100n).toLocaleString("en-US")}.${(minor % 100n).toString().padStart(2, "0")}`;
}
export function formatPkr(wholeRupees: string | number | bigint): string {
  const n = typeof wholeRupees === "bigint" ? wholeRupees : BigInt(String(wholeRupees).split(".")[0]);
  return `PKR ${n.toLocaleString("en-US")}`;
}
export function formatAmount(amount: string | number, currency: Currency): string {
  return currency === "USD" ? formatUsd(amount) : formatPkr(amount);
}
/** Illustrative PKR estimate for a USD price (display only, never an amount due). */
export function estimatePkr(listPriceUsd: string | number, rate: string | number): string {
  return formatPkr(usdMinorToPkrWhole(usdToMinor(listPriceUsd), parseRate(rate)));
}
