import Link from "next/link";
import { PriceUsdPkr, RateNote } from "@/components/Price";
import { getUsdPkr } from "@/lib/services/fx";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { normalizeDomain } from "@/lib/url-safety";
import { pageMeta, breadcrumbLd, jsonLdString, slugifyNiche } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import { Metric, Breadcrumbs, HelpTip, fmtDate } from "@/components/ui";
import { StarsDisplay } from "@/components/Stars";
import { loadRatings, loadReviews } from "@/lib/review-data";
import { summarizeRatings } from "@/lib/review";

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
  const pub = createPublicClient();
  const [reviews, ratings] = await Promise.all([loadReviews(pub, w.id, 20), loadRatings(pub, [w.id])]);
  const rating = ratings.get(w.id);
  const dist = summarizeRatings(reviews.map((r) => r.rating)).distribution;
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
  const chip = "rounded-full bg-mist px-2.5 py-0.5 text-xs text-inksoft";
  return (
    <section className="py-8 md:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
          <header className="lg:col-start-1">
            <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Publishers", href: "/publishers" }, ...(w.niche ? [{ label: w.niche, href: `/publishers/category/${slugifyNiche(w.niche)}` }] : []), { label: w.domain }]} />
            <h1 className="mb-2 break-all text-3xl font-semibold tracking-tight">{w.domain}</h1>
            <div className="mb-4 flex flex-wrap gap-1.5">
              <span className={chip}>{w.niche ?? "General"}</span>
              {w.country && <span className={chip}>{w.country}</span>}
              {w.language && <span className={chip}>{w.language}</span>}
              {w.link_type && <span className={chip}>{w.link_type} link</span>}
            </div>
            <div className="mb-4">{rating ? <a href="#reviews" className="hover:underline"><StarsDisplay rating={rating.average} count={rating.count} /></a> : <span className="text-sm text-inksoft">No reviews yet</span>}</div>
            {w.description && <p className="max-w-[65ch] whitespace-pre-line">{w.description}</p>}
          </header>

          <aside aria-label="Order this placement" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="card lg:sticky lg:top-24">
              <h2 className="mb-3 text-base font-semibold">Order a placement</h2>
              <dl className="mb-4 grid gap-3 text-sm">
                {w.price_guest_post != null && <div className="flex items-start justify-between gap-3"><dt>Guest post<span className="block text-xs text-inksoft">A new article published on this website</span></dt><dd className="text-right font-medium"><PriceUsdPkr usd={w.price_guest_post} rate={rate} /></dd></div>}
                {w.price_link_insertion != null && <div className="flex items-start justify-between gap-3"><dt>Link insertion<span className="block text-xs text-inksoft">A link added to an existing article</span></dt><dd className="text-right font-medium"><PriceUsdPkr usd={w.price_link_insertion} rate={rate} /></dd></div>}
                {w.turnaround_days_max != null && <div className="flex justify-between gap-3 border-t border-line pt-3"><dt className="text-inksoft">Delivery</dt><dd>{w.turnaround_days_min ? `${w.turnaround_days_min}-` : "Up to "}{w.turnaround_days_max} days</dd></div>}
              </dl>
              <Link className="btn-primary w-full !py-2.5" href={`/dashboard/orders/new?publisher=${w.id}`}>Order a placement</Link>
              <div className="mt-2 grid gap-2">
                <Link className="btn w-full" href="/check">Check my website first</Link>
                <Link className="btn w-full" href={`/dashboard/advice/new?publisher_id=${w.id}`}>Ask for advice</Link>
              </div>
              <p className="mt-3 text-xs text-inksoft">You sign in only when you press an order or advice button. Nothing is charged until you submit payment details.</p>
            </div>
          </aside>

          <div className="grid gap-6 lg:col-start-1">
            <div className="card">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">Website quality <HelpTip label="these figures">DR and DA are 0 to 100 scores of how strong a website&apos;s backlink profile is (from two different SEO tools). Organic traffic is the estimated monthly visits from search. Higher is generally stronger, but no score guarantees results.</HelpTip></h2>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                <Metric label="Domain Rating (DR)" value={m?.dr} status={m?.dr != null ? tag : "unavailable"} />
                <Metric label="Domain Authority (DA)" value={m?.da} status={m?.da != null ? tag : "unavailable"} />
                <Metric label="Monthly organic traffic" value={m?.organic_traffic != null ? Number(m.organic_traffic).toLocaleString("en-US") : null} status={m?.organic_traffic != null ? tag : "unavailable"} />
                <Metric label="Listing approved by PostAtlas" value={w.last_verified_at ? new Date(w.last_verified_at).toLocaleDateString("en-US") : "Yes"} status="observed" />
              </div>
              {!verified && <p className="mt-4 text-sm text-inksoft">These figures were supplied by the publisher and have not been checked by PostAtlas.</p>}
            </div>
            {w.article_requirements && <div className="card"><h2 className="mb-2 text-base font-semibold">Content requirements</h2><p className="whitespace-pre-line text-sm">{w.article_requirements}</p></div>}
            <section id="reviews" className="card" aria-labelledby="rv">
              <h2 id="rv" className="mb-1 text-base font-semibold">Reviews of {w.domain}</h2>
              <p className="mb-4 text-sm text-inksoft">Only customers who bought a placement here and had it verified can leave a review. Each order can be reviewed once, and reviewers are not named.</p>
              {!rating || reviews.length === 0 ? <p className="text-sm text-inksoft">No reviews yet. The first customer to complete an order here can rate it.</p> : (
                <>
                  <div className="mb-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
                    <div><div className="text-3xl font-semibold">{rating.average?.toFixed(1)}<span className="text-base font-normal text-inksoft"> / 5</span></div><StarsDisplay rating={rating.average} count={rating.count} showText={false} /><div className="text-sm text-inksoft">{rating.count} review{rating.count === 1 ? "" : "s"}</div></div>
                    <ul aria-label="Reviews by rating" className="grid gap-1 text-xs text-inksoft">{([5, 4, 3, 2, 1] as const).map((n) => <li key={n} className="flex items-center gap-2"><span className="w-12">{n} star{n === 1 ? "" : "s"}</span><span className="h-2 flex-1 overflow-hidden rounded bg-mist" aria-hidden><span className="block h-full bg-amber" style={{ width: `${reviews.length ? (dist[n] / reviews.length) * 100 : 0}%` }} /></span><span className="w-6 text-right">{dist[n]}</span></li>)}</ul>
                  </div>
                  <ul className="grid gap-3 border-t border-line pt-4">{reviews.map((r) => <li key={r.id} className="text-sm"><div className="flex flex-wrap items-center gap-2"><StarsDisplay rating={r.rating} showText={false} /><span className="text-xs text-inksoft">Verified buyer · {fmtDate(r.created_at)}</span></div>{r.comment && <p className="mt-1 whitespace-pre-line">{r.comment}</p>}</li>)}</ul>
                </>
              )}
            </section>
            <p className="text-sm text-inksoft">A placement is a link opportunity. It does not guarantee rankings, traffic or authority changes. We verify that your link is live after publication and keep checking it.</p>
            <RateNote rate={rate} />
          </div>
        </div>
      </div>
    </section>
  );
}
