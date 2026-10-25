import { LegalDocument } from "@/components/LegalDocument";
import { pageMeta } from "@/lib/seo";
import { LEGAL } from "@/lib/legal";
import { COMMISSION_BPS } from "@/lib/money";
import { PAYOUT_PROCESSING_HOURS, RESTORATION_DEADLINE_HOURS } from "@/lib/payout-policy";
import Link from "next/link";

export const metadata = pageMeta({ title: "Terms of Service", description: "The rules for using PostAtlas as a customer or a publisher: orders, payment, delivery deadlines, reviews, content rules and liability.", path: "/terms" });

export default function Terms() {
  const commission = `${COMMISSION_BPS / 100}%`;
  return (
    <LegalDocument
      title="Terms of Service"
      intro={<p>These terms are an agreement between you and {LEGAL.operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). They apply when you visit the website, create an account, order a placement as a customer, or list a website as a publisher. By creating an account or placing an order you accept them. If you do not agree, please do not use the service.</p>}
      sections={[
        { id: "service", title: "What PostAtlas is", body: (<>
          <p>PostAtlas is a marketplace and tracking service for link placements. Customers find pages on their own websites that need links, order a guest post or a link insertion on an approved publisher&apos;s website, and we check that the link is really live and keep checking it. Publishers are independent website owners. They are not our employees, and the website on which a placement appears belongs to them.</p>
          <p>A placement is a link opportunity. We do not promise or guarantee any search ranking, traffic, indexing, domain authority or revenue result.</p></>) },
        { id: "accounts", title: "Accounts and workspaces", body: (
          <ul>
            <li>You must be at least 18 and able to enter a contract, or act for a business that is.</li>
            <li>Give accurate information and keep your password private. You are responsible for what happens under your account.</li>
            <li>Customers work in a personal workspace or in a team workspace. Team roles decide who may manage websites, place and pay for orders, and submit content. An action your role does not allow will be refused.</li>
            <li>Publisher and administrator access is granted only by us, after review. We may refuse, suspend or close an account that breaks these terms.</li>
          </ul>) },
        { id: "orders", title: "Orders and payment", body: (<>
          <p>The price of a placement is the publisher&apos;s listed USD price when you place the order. We add no markup, tax or fee to it. You may choose to pay in PKR; the amount is the USD price converted at a market reference exchange rate that is shown and locked when you place the order. That rate is a reference, not your bank&apos;s rate.</p>
          <p>Payment is by manual bank or wallet transfer. You send the exact amount shown, then enter your payment reference. We review it by hand; nothing starts until we approve it. A reference is a claim until we have confirmed the money, and we may reject a payment we cannot match.</p>
          <p>You may only order links to pages on websites you have added to your account and that you have the right to promote.</p></>) },
        { id: "content", title: "Articles and content rules", body: (<>
          <p>For a guest post you supply the article as plain text. You confirm that you wrote it or have the right to use it, that it is accurate, and that it does not infringe anyone&apos;s rights. We scan every article, and hold it for human review if it touches casino and gambling, CBD and cannabis, vape and nicotine, adult content, or link networks and link manipulation. We and the publisher may refuse content that breaks these rules or the publisher&apos;s published requirements.</p>
          <p>You may not use PostAtlas for illegal activity, deception, spam, malware, hate or harassment, or to buy links as part of a scheme designed to manipulate search results in breach of search engines&apos; rules.</p></>) },
        { id: "delivery", title: "Delivery, deadlines and verification", body: (<>
          <p>After your payment is approved and your article is accepted, the order goes to the publisher, who may accept or decline it. The delivery clock starts when the publisher accepts. The deadline is the turnaround, stated by the publisher in hours, that the website listed when you ordered, and it is fixed for your order; the order page shows a live countdown. If the publisher misses it, you may ask for a refund or an alternative placement as described in our <Link href="/refund-policy">Refund Policy</Link>. Until you choose, the publisher may still deliver.</p>
          <p>When the publisher submits the live address we fetch the page and look for your link. A placement counts as verified only after that check finds it. We then check again periodically. If a verified link disappears, we notify you and the publisher. You may ask for a replacement, which goes to us and to the original publisher, who then submits the new live URL (with a fresh deadline) and has it verified automatically. Alternatively the publisher may restore it within {RESTORATION_DEADLINE_HOURS} hours at no extra cost; otherwise we may replace it or refund you.</p></>) },
        { id: "refunds", title: "Refunds and disputes", body: (
          <p>Refunds, replacements and cancellations are governed by our <Link href="/refund-policy">Refund Policy</Link>. If something is wrong with an order you can raise an issue from the order page. Our team reviews the evidence from both sides and decides the outcome, which may be no action, restoration, a replacement or a refund. Please use this process before contacting your bank or wallet provider about a payment.</p>) },
        { id: "reviews", title: "Reviews and ratings", body: (<>
          <p>A customer who bought a placement on a listed website, and whose placement was published and verified, may rate that website from 1 to 5 stars and add written feedback. Each order can be reviewed once, and a submitted review cannot be edited. Reviews appear on the website&apos;s listing page, not on the publisher&apos;s profile, and the reviewer is not named.</p>
          <p>Reviews must be honest, based on your own order, and free of web addresses, personal data, abuse and advertising. You may not offer or accept payment, refunds or other benefits in exchange for a particular rating. We may hide a review that breaks these rules, and we do not edit review text.</p></>) },
        { id: "publishers", title: "Terms for publishers", body: (
          <ul>
            <li>You may list only websites you own or control, with accurate prices, link type, turnaround (in hours) and requirements. Metrics you report are labelled as reported by you until we verify them.</li>
            <li>When you accept an order you commit to deliver within the listed turnaround, on your own listed domain, with the agreed link. If you cannot, decline it promptly rather than let the deadline pass.</li>
            <li>PostAtlas keeps a {commission} commission from the listed price. You are entitled to the rest once the placement is verified. We aim to start processing a payout within {PAYOUT_PROCESSING_HOURS} hours of verification; when it reaches your bank depends on the bank. Payouts need a verified bank account.</li>
            <li>You earn nothing for an order you decline, or one that is closed after a missed deadline, a refund or a replacement. Unpaid entitlement for such an order is cancelled; money already paid is not clawed back automatically.</li>
            <li>You must keep a published link in place as agreed and restore it if it disappears. Disputes on your orders are decided by our team.</li>
          </ul>) },
        { id: "ip", title: "Intellectual property", body: (
          <p>You keep the rights in your articles and websites and give the publisher and us permission to copy, publish and display your article as needed to carry out your order. PostAtlas&apos;s name, design and software belong to us. Reviews you write may be shown on the website listing for as long as the listing exists.</p>) },
        { id: "availability", title: "Availability and changes", body: (
          <p>We work to keep the service available but do not promise it will be uninterrupted or error free. We may change or withdraw features, listings and prices. We may update these terms; the effective date at the top shows the current version, and using the service after a change means you accept it. For a material change we will give notice by email or inside your account where we can.</p>) },
        { id: "liability", title: "Responsibility and liability", body: (<>
          <p>The service is provided &ldquo;as is&rdquo;. Publishers and their websites are independent and we do not control them, though we approve each listing and verify each placement. To the extent the law allows, we are not liable for indirect or consequential loss, loss of profit, ranking or traffic changes, or search-engine penalties, and our total liability for any claim about an order is limited to the amount you paid for that order.</p>
          <p>Nothing in these terms limits liability that cannot be limited by law, or your rights as a consumer where they apply.</p></>) },
        { id: "termination", title: "Suspension and closing your account", body: (
          <p>You may stop using PostAtlas at any time. We may suspend or close an account, listing or order that breaks these terms, puts others at risk or exposes us to legal liability. Money owed for work already delivered, and refunds due under the Refund Policy, are still settled afterwards. Sections that by their nature should continue (payment, liability, intellectual property, disputes) survive closure.</p>) },
        { id: "law", title: "Governing law and contact", body: (
          <p>These terms are governed by {LEGAL.governingLaw}, and its courts have jurisdiction, unless mandatory consumer law in your country says otherwise. To contact us, use the <Link href={LEGAL.contactPath}>contact form</Link>; we reply by email.</p>) }
      ]}
    />
  );
}
