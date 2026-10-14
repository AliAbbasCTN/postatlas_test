import Link from "next/link";
import { CheckForm } from "@/components/CheckForm";
import { FormFeedback } from "@/components/FormFeedback";
import { pageMeta, breadcrumbLd, jsonLdString } from "@/lib/seo";

// The website check can take up to ~30s; allow the host to run this route that long.
export const maxDuration = 60;
export const metadata = pageMeta({ title: "Check your website free - no account needed", description: "Enter your website and see what we can observe about it, plus publishers that fit your topic. Sign in only when you decide to order.", path: "/check" });

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ error?: string; domain?: string }> }) {
  const sp = await searchParams;
  return (
    <section className="py-12 md:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbLd([{ name: "Home", path: "/" }, { name: "Check your website", path: "/check" }])) }} />
      <div className="max-w-[860px] mx-auto px-6">
        <h1 className="font-serif font-bold text-4xl md:text-5xl leading-tight mb-4">Check your website, free</h1>
        <p className="text-lg text-inksoft mb-8 max-w-[58ch]">Tell us your website and its topic. In about 30 seconds you will see what we could observe about it and which publishers fit. You only sign in if you decide to order.</p>
        <FormFeedback error={sp.error} />
        <div className="card !p-6 md:!p-8 shadow-sm relative"><CheckForm defaultDomain={sp.domain} /></div>
        <ul className="grid sm:grid-cols-3 gap-4 mt-10 text-sm">
          {[["We only read public pages", "The same pages any visitor or search engine can open. Nothing is changed on your site."], ["Honest results", "Everything shown is something we actually saw. If we cannot measure something, we say so."], ["You stay in control", "No account, no card, no obligation. Order only if a publisher looks right."]].map(([t, b]) => (
            <li key={t} className="rounded-lg border border-line bg-white p-4"><strong className="block font-serif text-base mb-1">{t}</strong><span className="text-inksoft">{b}</span></li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-inksoft">Want to talk it through first? <Link className="underline text-verdigrisdark" href="/contact">Contact the team</Link>.</p>
      </div>
    </section>
  );
}
