import { LegalDocument } from "@/components/LegalDocument";
import { pageMeta } from "@/lib/seo";
import { LEGAL } from "@/lib/legal";
import Link from "next/link";

export const metadata = pageMeta({ title: "Privacy Policy", description: "What personal data PostAtlas collects, why, who it is shared with, how it is protected, and the choices you have.", path: "/privacy" });

export default function Privacy() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={<p>This policy explains what personal information {LEGAL.operator} collects when you use our website and service, what we do with it, and the choices you have. We collect only what we need to run the marketplace, and we do not sell personal information.</p>}
      sections={[
        { id: "collect", title: "What we collect", body: (
          <ul>
            <li><b>Account details:</b> your email address, name or display name, password (stored only as a secure hash by our authentication provider), and your workspace and role.</li>
            <li><b>Orders and websites:</b> the websites and pages you add, orders, article text and instructions, published links, check results, issues you raise, and messages you send us or the other party to an order.</li>
            <li><b>Payments:</b> the payment reference and amount you report for a manual transfer, and refund records. We do not receive or store card numbers.</li>
            <li><b>Publishers:</b> your listings, prices, and, if you want to be paid, bank account details. The account number is encrypted, only its last four digits are ever displayed, and staff see the full number only after an explicit, logged action.</li>
            <li><b>Reviews:</b> the rating and text you write. A review is shown on the website&apos;s listing without your name; we keep the link between a review and your order for moderation.</li>
            <li><b>Forms and the free website check:</b> what you type into the contact, Write for Us and website-check forms, including the domain you check.</li>
            <li><b>Technical data:</b> IP address, browser type and request logs, used for security and rate limiting, and the cookies described below.</li>
          </ul>) },
        { id: "use", title: "How we use it", body: (
          <ul>
            <li>To provide the service: create your account, process orders and payments, pass orders to publishers, verify and monitor links, handle issues and refunds, and pay publishers.</li>
            <li>To send notifications about your orders and account, in the app and by email.</li>
            <li>To keep the platform safe: prevent fraud and abuse, enforce content rules, rate-limit requests, and keep an audit trail of sensitive actions.</li>
            <li>To meet legal, tax and accounting duties, and to resolve disputes.</li>
            <li>To improve the service, using aggregated or de-identified information where possible.</li>
          </ul>) },
        { id: "share", title: "Who sees your information", body: (<>
          <p><b>The other side of an order.</b> A publisher sees what they need to fulfil an order: the target page and link text, your article and instructions, and issue messages. They do not see your identity, what you paid or your payment details. A customer sees the publisher&apos;s listing and domain.</p>
          <p><b>The public.</b> Listings, prices and reviews are public. Reviews never show who wrote them.</p>
          <p><b>Service providers</b> that process data for us: our database and authentication host (Supabase), our web host, our email provider (for notification emails), an exchange-rate data source (it receives no personal data), and, if we turn it on, an SEO data provider that receives only the website domains being analysed.</p>
          <p><b>Legal and safety.</b> We may disclose information if the law requires it or to protect people, the platform or our rights.</p>
          <p>We do not sell your personal information.</p></>) },
        { id: "cookies", title: "Cookies", body: (
          <p>We use only the cookies needed to keep you signed in and to remember which workspace you are using. We do not use advertising or cross-site tracking cookies. Our public pages can be browsed without an account.</p>) },
        { id: "security", title: "How we protect it", body: (
          <p>Data is stored with access rules that keep each workspace&apos;s information separate. All changes go through server-side checks of who you are and what you may do, sensitive actions are logged, payout account numbers are encrypted, and requests are rate limited. No system is perfectly secure, so please use a strong, unique password and tell us promptly if you suspect misuse of your account.</p>) },
        { id: "retention", title: "How long we keep it", body: (
          <p>We keep account and order information while your account is active and afterwards for as long as we need it to meet legal, tax and accounting duties, settle disputes and refunds, and keep our audit trail. Records of payments, refunds and payouts are kept for that reason even if an account is closed. When information is no longer needed we delete or de-identify it.</p>) },
        { id: "rights", title: "Your choices and rights", body: (<>
          <p>You can view and update your account details in your settings. Depending on where you live, you may also have the right to ask for a copy of your information, to correct it, to delete it, or to object to or restrict some uses. To make a request, <Link href={LEGAL.contactPath}>contact us</Link> from the email address on your account. We may need to verify your identity, and we may keep what the law or an open order requires.</p></>) },
        { id: "transfers", title: "International use", body: (
          <p>Our providers may process data in countries other than your own. Where we rely on them we expect them to protect it to a similar standard.</p>) },
        { id: "children", title: "Children", body: (
          <p>PostAtlas is for adults and businesses. It is not directed at anyone under 18, and we do not knowingly collect their information.</p>) },
        { id: "changes", title: "Changes and contact", body: (
          <p>We may update this policy; the effective date above shows the current version, and we will tell you about significant changes by email or in your account. For privacy questions or requests, use the <Link href={LEGAL.contactPath}>contact form</Link>.</p>) }
      ]}
    />
  );
}
