import Link from "next/link";
import { PriceUsdPkr, RateNote } from "@/components/Price";
import { getUsdPkr } from "@/lib/services/fx";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { NICHES } from "@/lib/niches";
import { pageMeta, slugifyNiche } from "@/lib/seo";
import { Pagination, parsePage, Money } from "@/components/ui";

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

  return (
    <section className="py-12">
      <div className="max-w-[1180px] mx-auto px-6">
        <h1 className="font-serif font-bold text-4xl mb-3">Publisher websites</h1>
        <p className="text-inksoft max-w-[62ch] mb-6">Real websites that accept guest posts and link placements. Every publisher is approved by our team. Authority and traffic figures only show as verified once we have checked them; until then they are labelled as reported by the publisher.</p>
        <nav aria-label="Topics" className="flex flex-wrap gap-2 mb-6 text-sm">{NICHES.map((n) => <Link key={n} className="px-3 py-1.5 border border-line rounded hover:bg-paperdim" href={`/publishers/category/${slugifyNiche(n)}`}>{n}</Link>)}</nav>
        <form method="get" className="card grid grid-cols-2 md:grid-cols-6 gap-4 mb-3" aria-label="Filter publishers">
          <div className="col-span-2 md:col-span-6"><label className="label" htmlFor="q">Search by domain</label><input id="q" name="q" type="search" defaultValue={term} maxLength={60} placeholder="e.g. techblog" className="input" /></div>
          <div><label className="label" htmlFor="niche">Topic</label><select id="niche" name="niche" defaultValue={niche} className="input"><option value="">Any</option>{NICHES.map((n) => <option key={n}>{n}</option>)}</select></div>
          <div><label className="label" htmlFor="link">Link type</label><select id="link" name="link" defaultValue={link} className="input"><option value="">Any</option><option>dofollow</option><option>nofollow</option><option>mixed</option></select></div>
          <div><label className="label" htmlFor="min_dr">Min. verified DR</label><input id="min_dr" name="min_dr" inputMode="numeric" defaultValue={minDr ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="max_price">Max. price (USD)</label><input id="max_price" name="max_price" inputMode="numeric" defaultValue={maxPrice ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="sort">Sort</label><select id="sort" name="sort" defaultValue={sort} className="input"><option value="newest">Newest</option><option value="price_asc">Price, low to high</option><option value="price_desc">Price, high to low</option></select></div>
          <div className="self-end"><button className="btn-primary w-full">Apply</button></div>
        </form>
        <p className="text-sm text-inksoft mb-5" aria-live="polite">{error ? "" : `${count ?? 0} publisher${count === 1 ? "" : "s"}`}{(term || niche || link || minDr != null || maxPrice != null) && <> match your filters. <Link href="/publishers" className="underline">Reset all filters</Link></>}</p>
        {error && <p role="alert" className="text-redsig">Publishers could not be loaded. Please try again.</p>}
        {!error && rows.length === 0 && <div className="border border-dashed border-line rounded-md p-8 text-inksoft"><strong className="block font-serif text-ink text-lg mb-1.5">No publishers match</strong>Try removing a filter or searching a shorter domain. <Link href="/publishers" className="underline">Reset all filters</Link></div>}
        {rows.length > 0 && (
          <ul className="grid gap-3">{rows.map((w) => { const m = Array.isArray(w.publisher_metrics) ? w.publisher_metrics[0] : w.publisher_metrics; return (
            <li key={w.id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0"><Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="font-serif font-semibold text-lg">{w.domain}</Link><div className="text-sm text-inksoft">{w.niche ?? "-"}{w.country ? ` · ${w.country}` : ""}{w.link_type ? ` · ${w.link_type}` : ""}</div></div>
              <div className="text-sm">{w.turnaround_days_max != null && <div className="text-xs text-inksoft mb-1">Delivery within {w.turnaround_days_max} days</div>}{m?.verified && m.dr != null ? <span>DR <b className="font-mono">{m.dr}</b> <span className="text-xs text-verdigrisdark">verified</span></span> : <span className="text-inksoft italic">Authority not verified</span>}</div>
              <div className="text-right"><PriceUsdPkr usd={w.price_guest_post ?? w.price_link_insertion} rate={rate} /><div className="text-xs text-inksoft">{w.price_guest_post != null ? "guest post" : "link insertion"}</div></div>
              <Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="btn-primary">View and order</Link>
            </li>); })}</ul>)}
        <RateNote rate={rate} />
        <Pagination basePath="/publishers" page={page} pageSize={PAGE} total={count ?? 0} params={{ q: term || undefined, niche, link, min_dr: minDr?.toString(), max_price: maxPrice?.toString(), sort: sort === "newest" ? undefined : sort }} />
      </div>
    </section>
  );
}
