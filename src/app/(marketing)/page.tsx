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
      <section className="border-b border-line bg-gradient-to-b from-paper to-paperdim">
        <div className="max-w-[1180px] mx-auto px-6 py-14 md:py-20 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center">
          <div>
            <p className="inline-block text-xs font-medium tracking-wide uppercase text-verdigrisdark bg-[#E4EEEA] rounded-full px-3 py-1 mb-5">Free website check · No account needed</p>
            <h1 className="font-serif font-bold text-[clamp(2.2rem,4.6vw,3.5rem)] leading-[1.08] mb-5">See how your website looks to search engines, then find publishers that fit.</h1>
            <p className="text-lg text-inksoft max-w-[54ch] mb-2">Takes about 30 seconds. You sign in only when you decide to place an order.</p>
          </div>
          <div className="card !p-6 md:!p-7 shadow-md relative">
            <h2 className="font-serif font-semibold text-xl mb-4">Check your website</h2>
            <CheckForm id="home" />
          </div>
        </div>
      </section>

      <section className="py-14 md:py-16">
        <div className="max-w-[1180px] mx-auto px-6">
          <h2 className="font-serif font-bold text-3xl mb-2">How it works</h2>
          <p className="text-inksoft mb-8">Four simple steps. You are never asked to commit before you have seen something useful.</p>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map(([t, b], i) => (
              <li key={t} className="rounded-xl border border-line bg-white p-5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-paper font-mono text-sm mb-3">{i + 1}</span><h3 className="font-serif font-semibold text-lg mb-1">{t}</h3><p className="text-sm text-inksoft">{b}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-12 bg-paperdim border-y border-line">
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
          <div className="mt-10 text-center"><Link href="/check" className="btn-primary !px-7 !py-3.5 !text-base">Check my website - free</Link><p className="text-sm text-inksoft mt-3">or <Link className="underline text-verdigrisdark" href="/publishers">browse publishers</Link></p></div>
        </div>
      </section>
    </>
  );
}
