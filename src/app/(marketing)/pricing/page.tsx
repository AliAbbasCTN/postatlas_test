import Link from "next/link";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Pricing: pay per placement", description: "You pay the publisher's listed price for each placement. The price is shown before you order and never changes afterwards.", path: "/pricing" });

export default function PricingPage() {
  return (
    <section className="py-14">
      <div className="max-w-[1000px] mx-auto px-6">
        <h1 className="font-serif font-bold text-4xl mb-3">Pay per placement</h1>
        <p className="text-inksoft max-w-[64ch] mb-10">There is no subscription to start. Each placement has a price shown on the publisher&apos;s page and again on your order. The price on your order is fixed when you create it.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {[["Guest post", "Priced per publisher. You send the article after your payment is approved."], ["Link in an existing article", "Priced per publisher. You tell the publisher where the link should go."], ["Verification and monitoring", "Included with every placement: we check the link after publication and keep re-checking."]].map(([t, b]) => (
            <div key={t} className="card"><h2 className="font-serif font-semibold text-xl mb-2">{t}</h2><p className="text-inksoft text-sm">{b}</p></div>
          ))}
        </div>
        <p className="mt-8 text-sm text-inksoft">Payment is manual: you receive instructions on your order and a team member approves it. See the <Link className="underline text-accenttext" href="/refund-policy">refund policy</Link>.</p>
      </div>
    </section>
  );
}
