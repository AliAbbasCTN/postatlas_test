import Link from "next/link";
import { PriceUsdPkr, RateNote } from "@/components/Price";
import { getUsdPkr } from "@/lib/services/fx";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { NICHES } from "@/lib/niches";
import { pageMeta, slugifyNiche } from "@/lib/seo";
import { StarsDisplay } from "@/components/Stars";
import { loadRatings } from "@/lib/review-data";
import { Pagination, parsePage, FilterChips, HelpTip, type Chip } from "@/components/ui";

const PAGE = 20;
type SP = { q?: string; niche?: string; link?: string; min_dr?: string; max_price?: string; sort?: string; page?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const filtered = !!(sp.q || sp.niche || sp.link || sp.min_dr || sp.max_price || sp.sort);
  const base = pageMeta({ title: "Publisher websites for guest posts and link placements", description: "Browse approved publisher websites by topic, price and link type. Figures that PostAtlas has not verified are labelled as reported by the publisher.", path: "/publishers", noindex: filtered });
  return base;
}

export default async function PublishersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ratePromise = getUsdPkr();   // started now so it runs alongside the listing query instead of before it
  // Domain search: whitelisted characters only, so nothing can alter the query (no wildcards, commas or operators reach PostgREST).
  const term = /^[a-z0-9][a-z0-9.-]{1,59}$/i.test((sp.q ?? "").trim()) ? (sp.q ?? "").trim().toLowerCase() : "";
  const niche = (NICHES as readonly string[]).includes(sp.niche ?? "") ? sp.niche! : "";
  const link = ["dofollow", "nofollow", "mixed"].includes(sp.link ?? "") ? sp.link! : "";
  const minDr = /^\d{1,3}$/.test(sp.min_dr ?? "") ? Math.min(100, Number(sp.min_dr)) : null;
  const maxPrice = /^\d{1,6}$/.test(sp.max_price ?? "") ? Number(sp.max_price) : null;
  const sort = ["price_asc", "price_desc", "newest"].includes(sp.sort ?? "") ? sp.sort! : "newest";
  const page = parsePage(sp.page);

  const db = createPublicClient();
  const metricsJoin = minDr != null ? "publisher_metrics!inner(dr, verified)" : "publisher_metrics(dr, verified)";
  let q = db.from("publisher_websites").select(`id, domain, niche, country, link_type, price_guest_post, price_link_insertion, turnaround_days_max, ${metricsJoin}`, { count: "exact" }).eq("status", "approved");
  if (term) q = q.ilike("domain", `%${term}%`);
  if (niche) q = q.eq("niche", niche);
  if (link) q = q.eq("link_type", link);
  // Either price may satisfy the cap (a publisher that only sells link insertions must not disappear when a price cap is set).
  if (maxPrice != null) q = q.or(`price_guest_post.lte.${maxPrice},price_link_insertion.lte.${maxPrice}`);
  if (minDr != null) q = q.eq("publisher_metrics.verified", true).gte("publisher_metrics.dr", minDr);
  q = sort === "price_asc" ? q.order("price_guest_post", { ascending: true, nullsFirst: false }) : sort === "price_desc" ? q.order("price_guest_post", { ascending: false, nullsFirst: false }) : q.order("created_at", { ascending: false });
  const [{ data, count, error }, rate] = await Promise.all([q.range((page - 1) * PAGE, page * PAGE - 1), ratePromise]);
  const rows: any[] = data ?? [];
  const ratings = await loadRatings(db, rows.map((w) => w.id));

  const params = { q: term || undefined, niche: niche || undefined, link: link || undefined, min_dr: minDr?.toString(), max_price: maxPrice?.toString(), sort: sort === "newest" ? undefined : sort };
  const chips: Chip[] = [
    term ? { key: "q", label: `Domain: ${term}` } : null,
    niche ? { key: "niche", label: `Topic: ${niche}` } : null,
    link ? { key: "link", label: `Link: ${link}` } : null,
    minDr != null ? { key: "min_dr", label: `Verified DR ${minDr}+` } : null,
    maxPrice != null ? { key: "max_price", label: `Up to $${maxPrice}` } : null
  ].filter((c): c is Chip => c !== null);
  const from = (page - 1) * PAGE + 1;
  const chip = "rounded-full bg-mist px-2 py-0.5 text-inksoft";

  return (
    <section className="py-10 md:py-12">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Explore sites you can publish on</h1>
        <p className="mb-6 max-w-[62ch] text-inksoft">Real websites that accept guest posts and link placements. Every publisher is approved by our team. Prices are shown up front. Authority figures show as verified only after we have checked them.</p>

        <form method="get" aria-label="Filter publishers" className="card mb-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div><label className="label" htmlFor="q">Search by domain</label><input id="q" name="q" type="search" defaultValue={term} maxLength={60} placeholder="e.g. techblog" className="input" /></div>
            <button className="btn-primary w-full sm:w-auto">Search</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="niche">Topic</label><select id="niche" name="niche" defaultValue={niche} className="input"><option value="">Any topic</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select></div>
            <div><label className="label" htmlFor="link">Link type</label><select id="link" name="link" defaultValue={link} className="input"><option value="">Any link type</option><option>dofollow</option><option>nofollow</option><option>mixed</option></select></div>
            <div><label className="label" htmlFor="sort">Sort by</label><select id="sort" name="sort" defaultValue={sort} className="input"><option value="newest">Newest</option><option value="price_asc">Price, low to high</option><option value="price_desc">Price, high to low</option></select></div>
          </div>
          <details open={minDr != null || maxPrice != null}>
            <summary className="cursor-pointer text-sm font-medium text-accenttext">More filters: authority and budget</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div><div className="mb-1.5 flex items-center gap-1.5"><label className="label !mb-0" htmlFor="min_dr">Minimum verified DR</label><HelpTip label="DR">Domain Rating is a 0 to 100 score of how strong a website&apos;s backlink profile is. Higher is stronger. It only counts here once PostAtlas has verified it.</HelpTip></div><input id="min_dr" name="min_dr" inputMode="numeric" defaultValue={minDr ?? ""} placeholder="e.g. 30" className="input" /></div>
              <div><label className="label" htmlFor="max_price">Maximum price (USD)</label><input id="max_price" name="max_price" inputMode="numeric" defaultValue={maxPrice ?? ""} placeholder="e.g. 150" className="input" /></div>
            </div>
          </details>
        </form>

        <nav aria-label="Browse by topic" className="-mx-1 mb-5 overflow-x-auto px-1">
          <ul className="flex min-w-max items-center gap-2 text-sm">
            <li className="pr-1 text-inksoft">Browse by topic:</li>
            {NICHES.map((n) => <li key={n}><Link className="inline-block rounded-full border border-line bg-white px-3 py-1 hover:bg-mist" href={`/publishers/category/${slugifyNiche(n)}`}>{n}</Link></li>)}
          </ul>
        </nav>

        <FilterChips basePath="/publishers" params={params} chips={chips} resetLabel="Clear all filters" />
        <p className="mb-4 text-sm text-inksoft" aria-live="polite">{error ? "" : rows.length === 0 ? "0 publishers" : `Showing ${from}-${from + rows.length - 1} of ${count ?? rows.length} publisher${count === 1 ? "" : "s"}`}</p>
        {error && <p role="alert" className="text-redsig">Publishers could not be loaded. Please try again.</p>}
        {!error && rows.length === 0 && <div className="rounded-lg border border-dashed border-linestrong bg-white p-8 text-inksoft"><strong className="mb-1.5 block text-base font-semibold text-ink">No publishers match</strong>Try removing a filter or searching a shorter domain. <Link href="/publishers" className="text-accenttext underline">Clear all filters</Link></div>}
        {rows.length > 0 && (
          <ul className="grid gap-3">{rows.map((w) => { const m = Array.isArray(w.publisher_metrics) ? w.publisher_metrics[0] : w.publisher_metrics; return (
            <li key={w.id} className="card !p-5">
              <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div className="min-w-0">
                  <Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="break-all text-base font-semibold hover:underline">{w.domain}</Link>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    {w.niche && <span className={chip}>{w.niche}</span>}
                    {w.country && <span className={chip}>{w.country}</span>}
                    {w.link_type && <span className={chip}>{w.link_type} link</span>}
                    {w.turnaround_days_max != null && <span className={chip}>Delivery within {w.turnaround_days_max} days</span>}
                  </div>
                  {ratings.get(w.id) && <div className="mt-2"><StarsDisplay rating={ratings.get(w.id)!.average} count={ratings.get(w.id)!.count} /></div>}
                  <div className="mt-2 text-sm">
                    {m?.verified && m.dr != null ? <span>DR <b className="font-mono">{m.dr}</b> <span className="text-xs text-verdigrisdark">verified</span></span> : <span className="italic text-inksoft">Authority not verified</span>} <HelpTip label="DR">Domain Rating is a 0 to 100 score of how strong a website&apos;s backlink profile is. It is shown as verified only after PostAtlas has checked it.</HelpTip>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-1">
                  {w.price_guest_post != null && <div><dt className="text-xs text-inksoft">Guest post</dt><dd><PriceUsdPkr usd={w.price_guest_post} rate={rate} compact /></dd></div>}
                  {w.price_link_insertion != null && <div><dt className="text-xs text-inksoft">Link insertion</dt><dd><PriceUsdPkr usd={w.price_link_insertion} rate={rate} compact /></dd></div>}
                </dl>
                <Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="btn-primary w-full md:w-auto">View and order</Link>
              </div>
            </li>); })}</ul>)}
        <RateNote rate={rate} />
        <Pagination basePath="/publishers" page={page} pageSize={PAGE} total={count ?? 0} params={params} />
      </div>
    </section>
  );
}
