import { LegalDocument } from "@/components/LegalDocument";
import { pageMeta } from "@/lib/seo";
import { LEGAL } from "@/lib/legal";
import { RESTORATION_DEADLINE_HOURS } from "@/lib/payout-policy";
import Link from "next/link";

export const metadata = pageMeta({ title: "Refund Policy", description: "When you can get a refund or an alternative placement on PostAtlas, how to ask for one, and how refunds are paid.", path: "/refund-policy" });

export default function RefundPolicy() {
  return (
    <LegalDocument
      title="Refund Policy"
      intro={<p>This policy explains when {LEGAL.operator} refunds an order, or replaces it with another placement, and how a refund is paid. It forms part of our <Link className="text-accenttext underline" href="/terms">Terms of Service</Link>. A placement is a link opportunity on a publisher&apos;s website; it is not a promise of rankings, traffic or authority, so the lack of any of those is not a reason for a refund.</p>}
      sections={[
        { id: "summary", title: "At a glance", body: (
          <ul>
            <li><b>Before you pay:</b> cancel any time. Nothing is charged.</li>
            <li><b>The publisher declines your order:</b> your payment stays safe. We arrange another publisher on the same terms, or refund you in full.</li>
            <li><b>The publisher misses the delivery deadline:</b> you choose a refund or an alternative placement.</li>
            <li><b>The link is not live, or disappears later:</b> the publisher must fix it at no extra cost; if it cannot be fixed we replace it or refund you.</li>
            <li><b>Published and verified as ordered:</b> not refundable because you changed your mind.</li>
          </ul>) },
        { id: "before-payment", title: "Before payment is confirmed", body: (<>
          <p>You pay by a manual bank or wallet transfer and then enter your payment reference. Our team checks it before anything starts. Until you submit a payment reference you can cancel the order yourself from the order page and you owe nothing. If you have already submitted a reference and want to stop, contact us before it is approved and we will cancel the order.</p>
          <p>If you sent a transfer and then cancelled, or sent the wrong amount, contact us with your reference and we will return it under the rules in section 7.</p></>) },
        { id: "before-acceptance", title: "After payment, before the publisher accepts", body: (
          <p>From payment approval until the publisher accepts, you may ask us to cancel the order and you will receive a full refund. Cancellation at this stage is done by our team (use <Link href={LEGAL.contactPath}>Contact</Link> or &ldquo;Get advice&rdquo; inside your account and quote the order). Once a publisher has accepted, the sections below apply instead.</p>) },
        { id: "declined", title: "The publisher declines the order", body: (
          <p>A publisher may decline a paid order. You are not charged again and the publisher earns nothing for it. Our team opens a recovery case and either gives the order to another approved publisher at the same price, with the same page, link text and article, or refunds you. The replacement never costs you more; if it costs us more, we bear the difference.</p>) },
        { id: "deadline", title: "The publisher misses the delivery deadline", body: (<>
          <p>The delivery clock starts when the publisher accepts your order. The deadline is the turnaround time the website listed when you ordered it (shown on the order page, for example 48 hours or 5 days). It does not change if the publisher later edits their listing. A listing that states no turnaround gets a standard 7 days.</p>
          <p>If the deadline passes before the live URL is submitted, we notify you and the order page offers two choices:</p>
          <ul>
            <li><b>Find me another publisher</b>: our team assigns another approved publisher on the same terms. If none is available we refund you.</li>
            <li><b>Request a refund</b>: we open a refund request for the full amount you paid (see section 7).</li>
          </ul>
          <p>Until you choose, the publisher may still deliver, and a delivered, verified placement is then handled normally. Once you choose, the order is closed for that publisher and they are not paid for it. Nothing is refunded automatically: every refund is reviewed by our team first.</p></>) },
        { id: "link-problems", title: "A placement is wrong, or the link disappears", body: (<>
          <p>After the publisher submits the live URL we check that your link is really on the page, and we keep checking. If the link is missing, points to the wrong page, carries a different attribute than agreed, or the page is removed, you can raise an issue from the order page. If a verified link disappears, the original publisher has {RESTORATION_DEADLINE_HOURS} hours to restore it at no extra charge to you.</p>
          <p>Our team decides the remedy: restoration, a replacement placement, a refund, or no remedy where the issue is not upheld. A refund after a placement was delivered may be reduced or refused where the link stayed live for a meaningful period, or where the problem was caused by something you changed (for example, removing the target page).</p></>) },
        { id: "how-refunds-work", title: "How a refund is requested, approved and paid", body: (<>
          <ol className="list-decimal pl-5 grid gap-1.5">
            <li><b>Requested:</b> you choose a refund on the order page, or our team files one for you.</li>
            <li><b>Reviewed and approved:</b> our team checks the order and the payment. A refund can never exceed what you paid.</li>
            <li><b>Paid:</b> we send the money back by manual bank or wallet transfer and record the transfer reference on your order. We do not use an automatic payment provider, so we cannot promise an exact day; we aim to move quickly and keep you updated on the order page.</li>
            <li><b>Closed:</b> the order shows as cancelled after a full refund is completed.</li>
          </ol>
          <p>Until step 3 is done, nothing has been refunded, even if the request has been approved.</p></>) },
        { id: "amount", title: "How much you get back", body: (<>
          <p>Refunds are made in the currency and amount you actually paid. If you paid in PKR at a locked exchange rate you are refunded that PKR amount; we do not recalculate it at a new rate. Fees your bank or wallet charged you for sending the original payment, or charges that apply when you receive the refund, are outside our control and are not refunded.</p></>) },
        { id: "not-refundable", title: "What is not refundable", body: (
          <ul>
            <li>A placement that was published and verified as ordered.</li>
            <li>Rankings, traffic, indexing or authority results. We never guarantee them.</li>
            <li>Orders cancelled by us because the article broke our content rules (gambling, CBD and cannabis, vape and nicotine, adult content, link networks) and was not corrected; we will still return money for work that was never started.</li>
            <li>Problems caused by changes you made after publication, or by details you gave us that were wrong.</li>
          </ul>) },
        { id: "publishers", title: "Publishers and payouts", body: (
          <p>A publisher is paid only for a placement that was delivered and verified. If an order is refunded or reassigned, the publisher&apos;s unpaid entitlement for it is cancelled. Money already transferred to a publisher is not taken back automatically; where that happens the cost of a replacement is borne by {LEGAL.operator}, not by you.</p>) },
        { id: "contact", title: "How to ask", body: (
          <p>Start from the order page: it shows the options that apply to that order right now. For anything else, <Link href={LEGAL.contactPath}>contact us</Link> with the order and what you would like us to do. We will reply by email. If you disagree with a decision you can raise an issue on the order and our team will review it.</p>) }
      ]}
    />
  );
}
