import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionError } from "@/lib/action-utils";
import { checkoutAmount, priceBreakdown, type Currency } from "@/lib/money";
import { getUsdPkr } from "@/lib/services/fx";

export type CheckoutMethod = { id: string; name: string; instructions: string | null; currencies: Currency[] };

/** Enabled payment methods, with the currencies each one really accepts. Account identifiers stay server-side here. */
export async function listCheckoutMethods(): Promise<CheckoutMethod[]> {
  const { data } = await createAdminClient().from("payment_methods").select("id, name, instructions, currencies").eq("enabled", true).order("name");
  return (data ?? []).map((m: { id: string; name: string; instructions: string | null; currencies: string[] }) => ({
    id: m.id, name: m.name, instructions: m.instructions, currencies: (m.currencies ?? ["USD"]).filter((c): c is Currency => c === "USD" || c === "PKR")
  }));
}

export type LockedCheckout = { currency: Currency; methodId: string; amountDue: string; fxRate: string | null; fxSource: string | null; fxAt: string | null; listPriceUsd: string; commissionUsd: string; publisherNetUsd: string };

/** The ONLY place an order's payable amount is decided. Browser input is just (currency, method id); everything else is looked up. */
export async function lockCheckout(listPriceUsd: string, currency: Currency, methodId: string): Promise<LockedCheckout> {
  const methods = await listCheckoutMethods();
  const method = methods.find((m) => m.id === methodId);
  if (!method) throw new ActionError("That payment method is not available.");
  if (!method.currencies.includes(currency)) throw new ActionError(`${method.name} does not accept ${currency}. Choose another method or currency.`);
  const b = priceBreakdown(listPriceUsd);
  let rate: string | null = null, src: string | null = null, at: string | null = null;
  if (currency === "PKR") {
    const r = await getUsdPkr();
    if (!r) throw new ActionError("PKR checkout is unavailable because no reliable exchange rate is available right now. Pay in USD or try again later.");
    if (!r.checkoutAllowed) throw new ActionError("PKR checkout is paused because the exchange rate is out of date. Pay in USD or try again later.");
    rate = r.rate; src = r.source; at = r.fetchedAt;
  }
  const c = checkoutAmount(listPriceUsd, currency, rate);
  return {
    currency, methodId, amountDue: c.amountDue, fxRate: c.fxRate, fxSource: src, fxAt: at, listPriceUsd,
    commissionUsd: (Number(b.commissionMinor) / 100).toFixed(2), publisherNetUsd: (Number(b.publisherNetMinor) / 100).toFixed(2)
  };
}
