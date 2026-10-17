import Link from "next/link";
import { pageMeta, jsonLdString } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import { CheckForm } from "@/components/CheckForm";

// The website check can take up to ~30s; allow the host to run this route that long.
export const maxDuration = 60;
export const metadata = pageMeta({ title: "PostAtlas - check your website free, then find the right publishers", description: "Check your website in about 30 seconds, see publishers that fit your topic, and only sign in when you decide to order. Every placement is verified and monitored.", path: "/" });

const steps = [
  ["Check your website", "Enter your address and topic. We read your public pages and show what we observed. No account needed."],
  ["See publishers that fit", "Get options matched to your topic, with the reasons and the price up front."],
  ["Order when you are ready", "Sign in only at this point. Pay manually, send your article, and follow every step."],
  ["We verify and keep watching", "We confirm your link is really live and re-check it, and tell you if anything changes."]
];

const faqs = [
  ["Do I need an account to check my website?", "No. The check and the publisher suggestions are open to everyone. You only sign in or create an account when you press the order button."],
  ["What do you actually measure?", "What we can observe by reading your public pages: whether the site is secure and responsive, page titles and descriptions, headings, mobile setup and whether pages are open to search engines. We do not invent backlink or authority numbers; where a figure is not measured, we say so."],
  ["Will a placement improve my rankings?", "We cannot promise that, and no one honestly can. A placement is a link opportunity on a relevant website. We make sure it is published as agreed and keep checking that it stays."],
  ["How do I pay?", "Payment is manual: after you create an order you get the payment details, and our team confirms your payment before anything starts."],
  ["Not sure what to choose?", "Ask the team. You can start a conversation from your dashboard, or use the contact form, without placing an order."]
];

export default function HomePage() {
  const ld = [
    { "@context": "https://schema.org", "@type": "Organization", name: "PostAtlas", url: absoluteUrl("/") },
    { "@context": "https://schema.org", "@type": "WebSite", name: "PostAtlas", url: absoluteUrl("/") },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-[1180px] items-center gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-5 inline-block rounded-full bg-accentsoft px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accenttext">Free website check · No account needed</p>
            <h1 className="mb-5 text-[clamp(2rem,4.4vw,3.25rem)] font-semibold leading-[1.1] tracking-tight">Find the Right Websites. Build Better Backlinks.</h1>
            <p className="mb-7 max-w-[54ch] text-lg text-inksoft">Discover relevant publishing opportunities, manage your placements, and monitor your backlinks from one streamlined SEO marketplace.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/publishers" className="btn-primary !px-5 !py-2.5 !text-base">Explore Sites</Link>
              <Link href="/for-publishers" className="btn !px-5 !py-2.5 !text-base">Become a Publisher</Link>
            </div>
            <p className="mt-4 text-sm text-inksoft">Not sure where to start? Run the free website check on the right - it takes about 30 seconds.</p>
          </div>
          <div className="card !p-6 shadow-pop md:!p-7">
            <h2 className="mb-1 text-lg font-semibold">Check your website</h2>
            <p className="mb-4 text-sm text-inksoft">See what we observe on your public pages, then get publisher suggestions that fit your topic.</p>
            <CheckForm id="home" />
          </div>
        </div>
      </section>

      <section aria-labelledby="paths" className="py-12 md:py-14">
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
          <h2 id="paths" className="mb-2 text-2xl font-semibold tracking-tight">Where do you want to start?</h2>
          <p className="mb-6 text-inksoft">Pick the one that describes you. You can always do both later with the same account.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card flex flex-col">
              <p className="eyebrow mb-2">I want backlinks</p>
              <h3 className="mb-2 text-lg font-semibold">Find a relevant website and order a placement</h3>
              <ul className="mb-5 grid gap-1.5 text-sm text-inksoft">
                <li>Check your website for free, no account needed.</li>
                <li>See publishers that fit your topic, with the price up front.</li>
                <li>Sign in only when you decide to order.</li>
              </ul>
              <div className="mt-auto flex flex-wrap gap-3"><Link href="/publishers" className="btn-primary">Explore Sites</Link><Link href="/check" className="btn">Check my website</Link></div>
            </div>
            <div className="card flex flex-col">
              <p className="eyebrow mb-2">I own a website</p>
              <h3 className="mb-2 text-lg font-semibold">List your website and receive placement orders</h3>
              <ul className="mb-5 grid gap-1.5 text-sm text-inksoft">
                <li>Create an account and apply. Our team reviews every publisher.</li>
                <li>Add your websites and set your own prices.</li>
                <li>Accept the orders you want and get paid after the link is verified.</li>
              </ul>
              <div className="mt-auto flex flex-wrap gap-3"><Link href="/for-publishers" className="btn-primary">Become a Publisher</Link><Link href="/login" className="btn">Log in</Link></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line py-14 md:py-16">
        <div className="max-w-[1180px] mx-auto px-6">
          <h2 className="font-serif font-bold text-3xl mb-2">How it works for customers</h2>
          <p className="text-inksoft mb-8">Four simple steps. You are never asked to commit before you have seen something useful.</p>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map(([t, b], i) => (
              <li key={t} className="rounded-lg border border-line bg-white p-5 shadow-card"><span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-navy font-mono text-sm text-white">{i + 1}</span><h3 className="font-serif font-semibold text-lg mb-1">{t}</h3><p className="text-sm text-inksoft">{b}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-line bg-white py-12">
        <div className="max-w-[1180px] mx-auto px-6 grid md:grid-cols-3 gap-8">
          {[["Honest by design", "Every figure says where it came from. Missing data is shown as missing, never guessed."], ["No pressure", "Look around freely. Ask questions before you order. Cancel an order that has not been paid."], ["A real person checks the money", "Payments and publishers are reviewed by our team before any work starts."]].map(([t, b]) => (
            <div key={t}><h3 className="font-serif font-semibold text-xl mb-1">{t}</h3><p className="text-inksoft text-sm">{b}</p></div>
          ))}
        </div>
      </section>

      <section className="py-14 md:py-16">
        <div className="max-w-[820px] mx-auto px-6">
          <h2 className="font-serif font-bold text-3xl mb-6">Questions people ask</h2>
          <div className="grid gap-3">
            {faqs.map(([q, a]) => (
              <details key={q} className="rounded-lg border border-line bg-white p-4 group"><summary className="cursor-pointer font-medium list-none flex justify-between gap-4">{q}<span aria-hidden className="text-inksoft group-open:rotate-45 transition">+</span></summary><p className="text-sm text-inksoft mt-3">{a}</p></details>
            ))}
          </div>
          <div className="mt-10 text-center"><Link href="/check" className="btn-primary !px-7 !py-3.5 !text-base">Check my website - free</Link><p className="text-sm text-inksoft mt-3">or <Link className="underline text-accenttext" href="/publishers">browse publishers</Link></p></div>
        </div>
      </section>
    </>
  );
}
