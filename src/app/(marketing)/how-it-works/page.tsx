import Link from "next/link";
import { pageMeta, breadcrumbLd, jsonLdString } from "@/lib/seo";

export const metadata = pageMeta({ title: "How PostAtlas works", description: "Diagnose which pages need links, match them with relevant publishers, order a placement, and have PostAtlas verify and monitor the link.", path: "/how-it-works" });

const steps = [
  ["Diagnose", "Add your website. We read your public pages and show which ones are worth strengthening. Link numbers appear only when a real data source supplies them."],
  ["Match", "Pick a page and see relevant publishers, each with a plain explanation of why it was suggested and what has not been verified."],
  ["Acquire", "Order a placement. Pay by manual transfer, send your article, and the publisher accepts and publishes it. Every step is visible to you."],
  ["Verify", "When the publisher submits the live URL, we check that your link is really on the page, points where it should and carries the expected attributes."],
  ["Monitor", "We keep re-checking. If the link disappears or changes you are told, and you can ask for a replacement."]
];

export default function HowItWorksPage() {
  return (
    <section className="py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbLd([{ name: "Home", path: "/" }, { name: "How it works", path: "/how-it-works" }])) }} />
      <div className="max-w-[1000px] mx-auto px-6">
        <h1 className="font-serif font-bold text-4xl mb-10 max-w-[40ch]">From the page that needs links to a placement that stays live</h1>
        <ol className="border-t border-ink">
          {steps.map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[64px_1fr] gap-5 py-6 border-b border-line">
              <span className="font-mono text-verdigrisdark text-lg">{String(i + 1).padStart(2, "0")}</span>
              <div><h2 className="font-serif font-semibold text-xl mb-1">{title}</h2><p className="text-inksoft">{body}</p></div>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-inksoft">Not ready to order? You can <Link className="underline text-verdigrisdark" href="/signup">create an account</Link> and ask the team for advice first.</p>
      </div>
    </section>
  );
}
