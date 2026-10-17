import Link from "next/link";
import { pageMeta, breadcrumbLd, jsonLdString } from "@/lib/seo";
import { COMMISSION_BPS } from "@/lib/money";

export const metadata = pageMeta({
  title: "For publishers: list your website and receive placement orders",
  description: "Create an account, apply as a publisher, list your websites and fulfil placement orders from customers. Every publisher and every listing is reviewed by the PostAtlas team.",
  path: "/for-publishers"
});

// "Publisher" means a verified account that LISTS WEBSITES AND RECEIVES ORDERS. It is not the same thing as writing an
// article for the PostAtlas blog (that is /write-for-us). Everything below describes behaviour that exists in the app.
const commission = `${(COMMISSION_BPS / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

const steps: [string, string][] = [
  ["Create an account", "Sign up with your email and confirm it. You use the same account later for the publisher area."],
  ["Apply as a publisher", "Tell us your name or company and describe your websites. Our team reviews every application before publisher access is granted."],
  ["List your websites", "Add each website with its topic, your prices for a guest post and/or a link insertion (in USD), delivery time, link type and content requirements. Our team approves each listing before customers can see it."],
  ["Receive and answer orders", "A customer orders and pays. Our team confirms the payment before you start. You then review the customer's article and accept or decline. If you decline, you give a reason."],
  ["Publish and send the live URL", "Publish the article on your website and submit the live URL. PostAtlas checks that the link is really on the page, then keeps re-checking it."],
  ["Get paid", "Once the placement is verified, your payout is created. Add a bank account (PKR or USD); our team verifies it. Payouts are made by bank transfer and recorded by our team."]
];

const faqs: [string, string][] = [
  ["Who can become a publisher?", "Anyone who owns or manages a website they can publish on. You describe your websites in the application, and our team decides."],
  ["Can I list a website before I am approved?", "No. Publisher access is granted after your application is approved, and each website is reviewed separately before customers can see it."],
  ["Who sets the price?", "You do. Customers pay your listed price. PostAtlas takes a " + commission + " commission, deducted from the publisher side, so your payout is your listed price minus that commission."],
  ["Are the numbers I enter (DR, DA, traffic) shown as facts?", "They are shown as reported by you until our team records verified figures with a source. Matching ignores unverified figures."],
  ["What happens if a link disappears later?", "Monitoring keeps checking. If a link is confirmed missing, you are asked to restore it, and the customer is told."],
  ["I want to write an article for the PostAtlas blog. Is that the same thing?", "No. Publishers list websites and receive orders. To contribute an article to our own blog, see Write for Us."]
];

export default function ForPublishersPage() {
  const ld = [
    breadcrumbLd([{ name: "Home", path: "/" }, { name: "For publishers", path: "/for-publishers" }]),
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <section className="border-b border-line bg-white">
        <div className="mx-auto max-w-[1180px] px-4 py-12 sm:px-6 md:py-16">
          <p className="eyebrow mb-3">For publishers</p>
          <h1 className="mb-4 max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-semibold leading-[1.1] tracking-tight">List your website. Receive placement orders.</h1>
          <p className="mb-7 max-w-[60ch] text-lg text-inksoft">Customers come to PostAtlas looking for relevant websites to publish on. You set your prices and decide which orders to accept. We check payments, verify the link and keep monitoring it.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/signup?next=${encodeURIComponent("/apply-publisher")}`} className="btn-primary !px-5 !py-2.5 !text-base">Create a publisher account</Link>
            <Link href="/apply-publisher" className="btn !px-5 !py-2.5 !text-base">I already have an account</Link>
          </div>
          <p className="mt-4 text-sm text-inksoft">Every publisher and every listing is reviewed by our team.</p>
        </div>
      </section>

      <section className="py-12 md:py-14">
        <div className="mx-auto max-w-[1000px] px-4 sm:px-6">
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">How it works for publishers</h2>
          <p className="mb-8 text-inksoft">Six steps from sign-up to payout. You can see where every order stands at any time.</p>
          <ol className="grid gap-3">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-4 rounded-lg border border-line bg-white p-5 shadow-card">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy font-mono text-sm text-white">{i + 1}</span>
                <div className="min-w-0"><h3 className="mb-1 text-base font-semibold">{title}</h3><p className="text-sm text-inksoft">{body}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-line bg-white py-12">
        <div className="mx-auto max-w-[820px] px-4 sm:px-6">
          <h2 className="mb-6 text-2xl font-semibold tracking-tight">Questions publishers ask</h2>
          <div className="grid gap-3">
            {faqs.map(([q, a]) => (
              <details key={q} className="group rounded-lg border border-line bg-white p-4"><summary className="flex cursor-pointer list-none justify-between gap-4 font-medium">{q}<span aria-hidden className="text-inksoft transition group-open:rotate-45">+</span></summary><p className="mt-3 text-sm text-inksoft">{a}</p></details>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href={`/signup?next=${encodeURIComponent("/apply-publisher")}`} className="btn-primary">Create a publisher account</Link>
            <Link href="/write-for-us" className="text-sm text-accenttext underline">Looking to write for our blog instead?</Link>
          </div>
        </div>
      </section>
    </>
  );
}
