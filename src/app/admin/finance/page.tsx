import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { getUsdPkr } from "@/lib/services/fx";
import { freshnessLabel } from "@/lib/fx";
import { setManualRate, refreshRateNow } from "@/lib/actions/finance-admin";
import { listCheckoutMethods } from "@/lib/services/finance";
import { setMethodCurrencies } from "@/lib/actions/payment-methods";
import { payoutEncryptionConfigured } from "@/lib/crypto";

export const metadata = { title: "Finance settings" };

export default async function AdminFinance({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const [rate, methods, { data: history }] = await Promise.all([
    getUsdPkr({ refresh: false }), listCheckoutMethods(),
    createAdminClient().from("fx_rates").select("rate, source, manual, fetched_at").eq("quote", "PKR").order("fetched_at", { ascending: false }).limit(8)
  ]);
  return (
    <div>
      <PageHeader title="Finance settings" subtitle="USD is the canonical currency. PKR is offered only where a payment method really accepts it and a recent rate exists." />
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />
      <section className="card mb-6">
        <h2 className="font-serif font-semibold text-lg mb-2">USD to PKR rate</h2>
        {rate ? <p className="text-sm">1 USD = <b className="font-mono">{Number(rate.rate).toFixed(2)}</b> PKR · {freshnessLabel(rate.freshness)} · {rate.manual ? "set manually" : rate.source} · {fmtDateTime(rate.fetchedAt)} · PKR checkout {rate.checkoutAllowed ? "allowed" : "PAUSED (rate older than 48 hours)"}</p>
          : <p className="text-sm text-redsig">No usable rate. PKR checkout is disabled and PKR estimates are hidden until a rate is refreshed or set.</p>}
        <div className="flex flex-wrap gap-4 mt-4">
          <form action={refreshRateNow}><button className="btn">Refresh from provider</button></form>
          <form action={setManualRate} className="flex flex-wrap gap-2 items-end">
            <div><label className="label" htmlFor="rate">Manual rate (PKR per USD)</label><input id="rate" name="rate" required className="input w-32" inputMode="decimal" /></div>
            <div><label className="label" htmlFor="note">Source note</label><input id="note" name="note" required minLength={3} maxLength={60} className="input w-48" placeholder="e.g. bank rate 10 Oct" /></div>
            <button className="btn-primary">Use this rate</button>
          </form>
        </div>
        <p className="text-xs text-inksoft mt-3">Automatic rates come from open.er-api.com (a market reference rate, updated daily, attribution required; check its terms for commercial use or set FX_API_KEY). It is not your bank&apos;s rate: use a manual rate if you settle at a different one.</p>
        <ul className="text-xs text-inksoft mt-3 grid gap-0.5">{(history ?? []).map((h: any, i: number) => <li key={i}>{fmtDateTime(h.fetched_at)} · {Number(h.rate).toFixed(2)} · {h.manual ? "manual" : h.source}</li>)}</ul>
      </section>
      <section className="card mb-6">
        <h2 className="font-serif font-semibold text-lg mb-2">Currencies per payment method</h2>
        <p className="text-sm text-inksoft mb-3">Tick PKR only for a method that can really receive rupees. New and existing methods start as USD-only.</p>
        <ul className="grid gap-3">{methods.map((m) => (
          <li key={m.id}><form action={setMethodCurrencies} className="flex flex-wrap gap-4 items-center text-sm"><input type="hidden" name="id" value={m.id} /><b className="min-w-40">{m.name}</b>
            <label className="flex gap-1.5"><input type="checkbox" name="usd" defaultChecked={m.currencies.includes("USD")} /> USD</label>
            <label className="flex gap-1.5"><input type="checkbox" name="pkr" defaultChecked={m.currencies.includes("PKR")} /> PKR</label>
            <button className="btn">Save</button></form></li>))}
          {methods.length === 0 && <li className="text-sm text-inksoft">No enabled payment methods.</li>}</ul>
      </section>
      <section className="card">
        <h2 className="font-serif font-semibold text-lg mb-2">Payouts</h2>
        <p className="text-sm">Payout detail encryption key: {payoutEncryptionConfigured() ? "configured" : <b className="text-redsig">missing (PAYOUT_DATA_KEY). Publishers cannot save payout details.</b>}</p>
        <p className="text-sm text-inksoft mt-1">Automatic payout provider: none connected. Transfers are made by an administrator and recorded under Payouts.</p>
      </section>
    </div>
  );
}
