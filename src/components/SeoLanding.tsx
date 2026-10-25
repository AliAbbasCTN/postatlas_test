import Link from "next/link";
import { Breadcrumbs } from "@/components/ui";
import { jsonLdString } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import { breadcrumbListLd, faqLd, serviceLd, articleLd } from "@/lib/seo-schema";
import type { Landing, Block } from "@/lib/landing-pages";

const PUBLISHED = "2026-10-24";

function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b, i) => b.kind === "p" ? <p key={i} className="text-inksoft">{b.text}</p>
    : b.kind === "ul" ? <ul key={i} className="grid list-disc gap-1.5 pl-5 text-inksoft">{b.items.map((t) => <li key={t}>{t}</li>)}</ul>
    : <ol key={i} className="grid gap-3">{b.items.map(([t, d], n) => <li key={t} className="grid grid-cols-[2.5rem_1fr] gap-3"><span className="font-mono text-accenttext" aria-hidden>{String(n + 1).padStart(2, "0")}</span><div><h3 className="font-semibold">{t}</h3><p className="text-inksoft">{d}</p></div></li>)}</ol>)}</>;
}

// One layout for every search landing page. Server component, no client JavaScript. Structured data is generated from the same
// content that is visible on the page (Service or Article, BreadcrumbList, FAQPage).
export function SeoLanding({ page }: { page: Landing }) {
  const base = absoluteUrl("/").replace(/\/$/, "");
  const ld = [
    breadcrumbListLd(base, [{ name: "Home", path: "/" }, { name: page.crumb, path: page.path }]),
    page.kind === "service"
      ? serviceLd(base, { name: page.h1, description: page.metaDescription, path: page.path, serviceType: page.serviceType ?? "Link building" })
      : articleLd(base, { headline: page.h1, description: page.metaDescription, path: page.path, datePublished: PUBLISHED, dateModified: PUBLISHED }),
    faqLd(page.faqs)
  ];
  return (
    <article className="py-10 md:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="mx-auto max-w-[820px] px-4 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: page.crumb }]} />
        <h1 className="mb-4 mt-2 text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{page.h1}</h1>
        <p className="mb-8 max-w-[65ch] text-lg text-inksoft">{page.lead}</p>
        <div className="mb-10 flex flex-wrap gap-3"><Link href={page.cta.href} className="btn-primary !px-5 !py-2.5">{page.cta.label}</Link><Link href="/how-it-works" className="btn !px-5 !py-2.5">How it works</Link></div>
        <div className="grid gap-10">
          {page.sections.map((s) => (
            <section key={s.h2} aria-labelledby={`h-${s.h2.length}-${s.h2.charCodeAt(0)}`} className="grid gap-3">
              <h2 id={`h-${s.h2.length}-${s.h2.charCodeAt(0)}`} className="text-2xl font-semibold tracking-tight">{s.h2}</h2>
              <Blocks blocks={s.blocks} />
              {s.sub?.map((x) => <div key={x.h3} className="grid gap-2"><h3 className="text-lg font-semibold">{x.h3}</h3><Blocks blocks={x.blocks} /></div>)}
            </section>
          ))}
          <section aria-labelledby="faq" className="grid gap-3">
            <h2 id="faq" className="text-2xl font-semibold tracking-tight">Questions people ask</h2>
            <dl className="grid gap-4">{page.faqs.map((f) => <div key={f.q} className="card !p-4"><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-inksoft">{f.a}</dd></div>)}</dl>
          </section>
          <nav aria-label="Related pages" className="border-t border-line pt-6">
            <h2 className="mb-2 text-base font-semibold">Related</h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{page.related.map((r) => <li key={r.href}><Link className="text-accenttext underline" href={r.href}>{r.label}</Link></li>)}</ul>
          </nav>
        </div>
      </div>
    </article>
  );
}
