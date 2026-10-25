import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { NICHES } from "@/lib/niches";
import { pageMeta, slugifyNiche, breadcrumbLd, jsonLdString } from "@/lib/seo";
import { Money } from "@/components/ui";

export const revalidate = 3600;
const find = (slug: string) => NICHES.find((n) => slugifyNiche(n) === slug);

async function load(niche: string) {
  const { data } = await createPublicClient().from("publisher_websites").select("id, domain, country, link_type, price_guest_post, price_link_insertion, publisher_metrics(dr, verified)").eq("status", "approved").eq("niche", niche).order("domain").limit(60);
  return data ?? [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const niche = find(slug);
  if (!niche) return {};
  const rows = await load(niche);
  return pageMeta({ title: `${niche} publishers for guest posts and link placements`, description: `Approved ${niche.toLowerCase()} websites you can order placements on, with prices and link types shown up front.`, path: `/publishers/category/${slug}`, noindex: rows.length < 3 });
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const niche = find(slug);
  if (!niche) notFound();
  const rows: any[] = await load(niche);
  return (
    <section className="py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbLd([{ name: "Home", path: "/" }, { name: "Publishers", path: "/publishers" }, { name: niche, path: `/publishers/category/${slug}` }])) }} />
      <div className="max-w-[1180px] mx-auto px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-inksoft mb-4"><Link href="/">Home</Link> / <Link href="/publishers">Publishers</Link> / {niche}</nav>
        <h1 className="font-serif font-bold text-4xl mb-3">{niche} publishers</h1>
        <p className="text-inksoft max-w-[62ch] mb-8">Websites in this topic that our team has approved. Compare prices and link types, then open a publisher for details.</p>
        {rows.length === 0 ? <p className="text-inksoft">No approved publishers in this topic yet. <Link className="underline text-accenttext" href="/publishers">Browse all publishers</Link>.</p> : (
          <ul className="grid gap-3">{rows.map((w) => { const m = Array.isArray(w.publisher_metrics) ? w.publisher_metrics[0] : w.publisher_metrics; return (
            <li key={w.id} className="card flex flex-wrap items-center justify-between gap-4"><div><Link href={`/publishers/${encodeURIComponent(w.domain)}`} className="font-serif font-semibold text-lg">{w.domain}</Link><div className="text-sm text-inksoft">{w.country ?? ""}{w.link_type ? ` · ${w.link_type}` : ""}</div></div>
              <div className="text-sm">{m?.verified && m.dr != null ? <>DR <b className="font-mono">{m.dr}</b> <span className="text-xs text-verdigrisdark">verified</span></> : <span className="italic text-inksoft">Authority not verified</span>}</div>
              <Money value={w.price_guest_post ?? w.price_link_insertion} /></li>); })}</ul>)}
        <p className="mt-10 text-sm text-inksoft">Not sure which topic fits your pages? <Link className="underline text-accenttext" href="/authority-audit">See how the Authority Audit works</Link>.</p>
      </div>
    </section>
  );
}
