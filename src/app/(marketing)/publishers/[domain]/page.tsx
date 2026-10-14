import Link from "next/link";
import { PriceUsdPkr, RateNote } from "@/components/Price";
import { getUsdPkr } from "@/lib/services/fx";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { normalizeDomain } from "@/lib/url-safety";
import { pageMeta, breadcrumbLd, jsonLdString, slugifyNiche } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import { Metric } from "@/components/ui";

export const revalidate = 3600;

async function load(raw: string) {
  const domain = normalizeDomain(decodeURIComponent(raw));
  if (!domain) return null;
  const { data } = await createPublicClient().from("publisher_websites")
    .select("id, domain, description, niche, country, language, price_guest_post, price_link_insertion, turnaround_days_min, turnaround_days_max, link_type, article_requirements, last_verified_at, publisher_metrics(dr, da, organic_traffic, verified, verified_at, metrics_source)")
    .eq("domain", domain).eq("status", "approved").maybeSingle();
  return data as any;
}

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }): Promise<Metadata> {
  const { domain } = await params;
  const w = await load(domain);
  if (!w) return { robots: { index: false, follow: false } };
  const topic = w.niche ? ` ${w.niche.toLowerCase()}` : "";
  return pageMeta({ title: `${w.domain}: guest post and link placement`, description: `Order a placement on ${w.domain}${topic ? `, a${topic} website` : ""}. See the price, link type, turnaround and content requirements before you order.`.slice(0, 160), path: `/publishers/${encodeURIComponent(w.domain)}` });
}

export default async function PublisherPage({ params }: { params: Promise<{ domain: string }> }) {
  const rate = await getUsdPkr();
  const { domain } = await params;
  const w = await load(domain);
  if (!w) notFound();
  const m = Array.isArray(w.publisher_metrics) ? w.publisher_metrics[0] : w.publisher_metrics;
  const verified = !!m?.verified;
  const path = `/publishers/${encodeURIComponent(w.domain)}`;
  // Structured data mirrors only what is visible on the page.
  const offers = [
    w.price_guest_post != null && { "@type": "Offer", name: "Guest post", price: String(w.price_guest_post), priceCurrency: "USD", url: absoluteUrl(path) },
    w.price_link_insertion != null && { "@type": "Offer", name: "Link insertion", price: String(w.price_link_insertion), priceCurrency: "USD", url: absoluteUrl(path) }
  ].filter(Boolean);
  const ld = [
    breadcrumbLd([{ name: "Home", path: "/" }, { name: "Publishers", path: "/publishers" }, ...(w.niche ? [{ name: w.niche, path: `/publishers/category/${slugifyNiche(w.niche)}` }] : []), { name: w.domain, path }]),
    { "@context": "https://schema.org", "@type": "Service", name: `Guest post and link placement on ${w.domain}`, provider: { "@type": "Organization", name: "PostAtlas", url: absoluteUrl("/") }, serviceType: "Sponsored content placement", url: absoluteUrl(path), ...(offers.length ? { offers } : {}) }
  ];
  const tag = verified ? "verified" : "self_reported";
  return (
    <section className="py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="max-w-[1000px] mx-auto px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-inksoft mb-4"><Link href="/">Home</Link> / <Link href="/publishers">Publishers</Link>{w.niche && <> / <Link href={`/publishers/category/${slugifyNiche(w.niche)}`}>{w.niche}</Link></>} / {w.domain}</nav>
        <h1 className="font-serif font-bold text-4xl mb-2">{w.domain}</h1>
        <p className="text-inksoft mb-6">{w.niche ?? "General"}{w.country ? ` · ${w.country}` : ""}{w.language ? ` · ${w.language}` : ""}</p>
        {w.description && <p className="max-w-[65ch] mb-8 whitespace-pre-line">{w.description}</p>}
        <div className="card grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
          <Metric label="Domain Rating (DR)" value={m?.dr} status={m?.dr != null ? tag : "unavailable"} />
          <Metric label="Domain Authority (DA)" value={m?.da} status={m?.da != null ? tag : "unavailable"} />
          <Metric label="Monthly organic traffic" value={m?.organic_traffic != null ? Number(m.organic_traffic).toLocaleString("en-US") : null} status={m?.organic_traffic != null ? tag : "unavailable"} />
          <Metric label="Listing approved by PostAtlas" value={w.last_verified_at ? new Date(w.last_verified_at).toLocaleDateString("en-US") : "Yes"} status="observed" />
        </div>
        <RateNote rate={rate} />
        {!verified && <p className="text-sm text-inksoft mb-6">These figures were supplied by the publisher and have not been checked by PostAtlas.</p>}
        <div className="card grid sm:grid-cols-2 gap-6 mb-6">
          <div><h2 className="font-serif font-semibold text-lg mb-2">Placement options</h2><ul className="text-sm grid gap-1">
            {w.price_guest_post != null && <li>Guest post: <b><PriceUsdPkr usd={w.price_guest_post} rate={rate} /></b></li>}
            {w.price_link_insertion != null && <li>Link in an existing article: <b><PriceUsdPkr usd={w.price_link_insertion} rate={rate} /></b></li>}
            <li>Link type: {w.link_type ?? "not stated"}</li>
            {w.turnaround_days_max != null && <li>Turnaround: {w.turnaround_days_min ? `${w.turnaround_days_min}-` : "up to "}{w.turnaround_days_max} days</li>}</ul></div>
          {w.article_requirements && <div><h2 className="font-serif font-semibold text-lg mb-2">Content requirements</h2><p className="text-sm whitespace-pre-line">{w.article_requirements}</p></div>}
        </div>
        <p className="text-sm text-inksoft mb-6">A placement is a link opportunity. It does not guarantee rankings, traffic or authority changes. We verify that your link is live after publication and keep checking it.</p>
        <div className="rounded-xl border border-line bg-white p-5 flex flex-wrap items-center gap-4">
          <Link className="btn-primary !px-6 !py-3" href={`/dashboard/orders/new?publisher=${w.id}`}>Order a placement</Link>
          <Link className="btn !py-3" href="/check">Check my website first</Link>
          <Link className="btn !py-3" href={`/dashboard/advice/new?publisher_id=${w.id}`}>Ask for advice</Link>
          <p className="text-xs text-inksoft w-full">You sign in only when you press an order or advice button. Nothing is charged until you submit payment details.</p>
        </div>
      </div>
    </section>
  );
}
