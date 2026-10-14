import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createOrder } from "@/lib/actions/orders";
import { SubmitButton } from "@/components/SubmitButton";
import { PageHeader, Money } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { isUuid } from "@/lib/validation";
import { orgCan } from "@/lib/permissions";
import { PriceUsdPkr, RateNote } from "@/components/Price";
import { getUsdPkr } from "@/lib/services/fx";
import { listCheckoutMethods } from "@/lib/services/finance";

export const metadata = { title: "New order" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ publisher?: string; opportunity?: string; target?: string; error?: string }> }) {
  const sp = await searchParams;
  const { org } = await requireWorkspace();
  if (!sp.publisher || !isUuid(sp.publisher)) notFound();
  const supabase = await createServerSupabaseClient();
  const { data: listing } = await supabase.from("publisher_websites").select("id, domain, niche, price_guest_post, price_link_insertion, turnaround_days_min, turnaround_days_max, link_type, article_requirements, status").eq("id", sp.publisher).eq("status", "approved").maybeSingle();
  if (!listing) notFound();
  const opp = sp.opportunity && isUuid(sp.opportunity) ? (await supabase.from("opportunities").select("id, page_url").eq("id", sp.opportunity).eq("organization_id", org.id).maybeSingle()).data : null;
  const { data: sites } = await supabase.from("websites").select("domain").eq("organization_id", org.id).limit(25);

  if (!sites || sites.length === 0) {
    return (
      <div className="max-w-xl">
        <PageHeader title={`Order a placement on ${listing.domain}`} />
        <div className="card"><strong className="font-serif block text-lg mb-1">First, tell us which website the link is for</strong>
          <p className="text-sm text-inksoft mb-4">A placement links to a page on your website, so we need your website on your account. It takes a moment, and you get a free check of it too.</p>
          <div className="flex gap-3 flex-wrap"><Link className="btn-primary" href="/dashboard/websites">Add my website</Link><Link className="btn" href="/check">Run a free check instead</Link></div></div>
      </div>
    );
  }
  const [rate, methods] = await Promise.all([getUsdPkr(), listCheckoutMethods()]);
  if (!orgCan(org.role, "manageOrders")) return <p className="text-inksoft">Your role in this team cannot place orders. Ask a team owner, or switch to your personal account in Settings.</p>;
  return (
    <div className="max-w-xl">
      <PageHeader title={`Order a placement on ${listing.domain}`} subtitle="Review the details. The price comes from the publisher's listing and cannot be changed here." />
      <FormFeedback error={sp.error} />
      <form action={createOrder} className="card">
        <input type="hidden" name="publisher_id" value={listing.id} />
        {opp && <input type="hidden" name="opportunity_id" value={opp.id} />}
        <fieldset className="mb-5"><legend className="label">Placement type</legend>
          {listing.price_guest_post != null && <label className="flex items-center gap-2 text-sm mb-1.5"><input type="radio" name="order_type" value="guest_post" defaultChecked required /> Guest post - <PriceUsdPkr usd={listing.price_guest_post} rate={rate} compact /></label>}
          {listing.price_link_insertion != null && <label className="flex items-center gap-2 text-sm"><input type="radio" name="order_type" value="link_insertion" defaultChecked={listing.price_guest_post == null} required /> Link in an existing article - <PriceUsdPkr usd={listing.price_link_insertion} rate={rate} compact /></label>}
        </fieldset>
        {opp ? <div className="mb-5 text-sm"><div className="label">Page to link to</div><div className="break-all text-inksoft">{opp.page_url}</div></div> : (
          <div className="mb-5"><label className="label" htmlFor="target_url">Page to link to</label><input id="target_url" name="target_url" required maxLength={2048} defaultValue={sp.target && sp.target.length <= 2048 ? sp.target : undefined} placeholder={`https://${sites?.[0]?.domain ?? "yourwebsite.com"}/your-page`} className="input" />
            <p className="text-xs text-inksoft mt-1">Must be a page on a website you have added{sites && sites.length ? ` (${sites.map((s: any) => s.domain).join(", ")})` : ""}.</p></div>
        )}
        <div className="mb-5"><label className="label" htmlFor="checkout">How will you pay?</label>
          {(() => {
            const options = methods.flatMap((m) => m.currencies.filter((c) => c === "USD" || (c === "PKR" && rate?.checkoutAllowed)).map((c) => ({ value: `${m.id}:${c}`, label: `${m.name}: pay in ${c}` })));
            return options.length === 0
              ? <p className="text-sm text-redsig">No payment method is available right now{methods.some((m) => m.currencies.includes("PKR")) && !rate?.checkoutAllowed ? " (PKR checkout is paused until the exchange rate is refreshed)" : ""}. Please try again later.</p>
              : <select id="checkout" name="checkout" required className="input"><option value="">Choose...</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
          })()}
          <p className="text-xs text-inksoft mt-1">The price is the publisher&apos;s list price in USD, with no markup or fees added. If you pay in PKR, the rupee amount is calculated and locked when you place the order and will not change afterwards.</p></div>
        <div className="mb-5"><label className="label" htmlFor="anchor_text">Link text (optional)</label><input id="anchor_text" name="anchor_text" maxLength={100} className="input" /></div>
        <ul className="text-sm text-inksoft list-disc pl-5 mb-5">
          <li>Link type on this site: {listing.link_type ?? "not stated"}</li>
          {listing.turnaround_days_max && <li>Typical turnaround: up to {listing.turnaround_days_max} days</li>}
          <li>You pay manually after creating the order; the publisher starts only after your payment is approved and your article is submitted.</li>
          <li>We do not promise rankings or traffic. A placement is a link opportunity.</li>
        </ul>
        <div className="flex gap-3"><SubmitButton pendingText="Creating order..." className="btn-primary">Create order</SubmitButton><Link href="/dashboard/opportunities" className="btn">Back</Link></div>
      </form>
      <RateNote rate={rate} />
    </div>
  );
}
