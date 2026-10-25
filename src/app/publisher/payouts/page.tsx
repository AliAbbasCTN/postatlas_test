import { requirePublisher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, fmtDateTime } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { saveDestination } from "@/lib/actions/payout-settings";
import { formatUsd } from "@/lib/money";
import { maskedDestination } from "@/lib/payout-policy";
import { payoutEncryptionConfigured } from "@/lib/crypto";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Payouts" };

const STATUS_TEXT: Record<string, string> = {
  ELIGIBLE: "Eligible: waiting to be processed", HELD: "On hold", PROCESSING: "Being processed", PAID: "Paid", FAILED: "Transfer failed: we will retry",
  UNCERTAIN: "Being checked with the bank", CANCELLED: "Cancelled"
};

export default async function PublisherPayouts({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const { user } = await requirePublisher();
  const db = createAdminClient();
  // The publisher profile comes from the session; a publisher can only ever see their own rows.
  const { data: profile } = await db.from("publisher_profiles").select("id").eq("user_id", user.id).maybeSingle();
  const [{ data: dests }, { data: payouts }] = profile ? await Promise.all([
    db.from("payout_destinations").select("id, currency, bank_name, account_last4, account_holder, status, disabled_reason, created_at, verified_at").eq("publisher_id", profile.id).order("created_at", { ascending: false }).limit(10),
    db.from("publisher_payouts").select("id, amount, kind, status, process_by, hold_reason, payout_currency, payout_amount, confirmed_at, publisher_websites:listing_id(domain)").eq("publisher_id", profile.id).order("created_at", { ascending: false }).limit(50)
  ]) : [{ data: [] }, { data: [] }];
  const rows: any[] = payouts ?? [];
  const sum = (st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0) / 100;
  const hasVerified = (dests ?? []).some((d: any) => d.status === "VERIFIED");
  const hasPending = (dests ?? []).some((d: any) => d.status === "PENDING_VERIFICATION");
  const readiness = hasVerified ? { icon: "✔", label: "Ready for payouts", help: "Your payout method is verified. Eligible payouts will be sent to it." }
    : hasPending ? { icon: "…", label: "Awaiting verification", help: "We received your details and are checking them. Payouts are paused until this is done, then they start automatically." }
    : (dests ?? []).length > 0 ? { icon: "!", label: "Needs attention", help: "Your last payout details were rejected or replaced. Add new details so payouts can start." }
    : { icon: "!", label: "Not set up", help: "Add where you want to be paid. Without a verified payout method we cannot send your earnings." };
  return (
    <div>
      <PageHeader title="Payouts" subtitle="You earn 98% of your listed USD price (PostAtlas keeps a 2% commission). We aim to start processing within 12 hours after your link is verified; your bank decides when the money arrives." />
      <FormFeedback error={sp.error} success={sp.notice} />
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <div className="card"><div className="text-xs text-inksoft">Waiting / processing</div><div className="font-mono text-2xl">{formatUsd(sum(["ELIGIBLE", "PROCESSING", "FAILED", "UNCERTAIN"]).toFixed(2))}</div></div>
        <div className="card"><div className="text-xs text-inksoft">On hold</div><div className="font-mono text-2xl">{formatUsd(sum(["HELD"]).toFixed(2))}</div></div>
        <div className="card"><div className="text-xs text-inksoft">Paid</div><div className="font-mono text-2xl">{formatUsd(sum(["PAID"]).toFixed(2))}</div></div>
      </div>

      <section className="card mb-6" aria-labelledby="payout-method-h">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <h2 id="payout-method-h" className="font-serif font-semibold text-lg">Payout method</h2>
          <span className="status-pill" role="status">{readiness.icon} {readiness.label}</span>
        </div>
        <p className="text-sm mb-3">{readiness.help}</p>
        <p className="text-xs text-inksoft mb-4"><b>Supported method:</b> bank transfer (USD or PKR account), sent manually by our team. Other methods such as PayPal, Payoneer or cards are not supported. You always earn in USD; a PKR account is paid the PKR equivalent and the rate used is recorded.</p>
        {(dests ?? []).length > 0 && (
          <ul className="grid gap-2 text-sm mb-4">{(dests ?? []).map((d: any) => (
            <li key={d.id} className="rounded border border-line p-3 flex flex-wrap justify-between gap-2">
              <span><b>{maskedDestination(d.account_last4, d.bank_name)}</b> · {d.currency} · {d.account_holder}</span>
              <span className="text-xs text-inksoft">{d.status === "VERIFIED" ? `✔ Verified ${d.verified_at ? fmtDateTime(d.verified_at) : ""}` : d.status === "PENDING_VERIFICATION" ? `… Waiting for verification (saved ${fmtDateTime(d.created_at)})` : `✖ Disabled${d.disabled_reason ? `: ${d.disabled_reason}` : ""} (${fmtDateTime(d.created_at)})`}</span>
            </li>))}</ul>)}
        {!payoutEncryptionConfigured() ? <p className="text-sm text-redsig" role="alert">Saving payout details is temporarily unavailable on the platform. Nothing you entered is lost; please contact support.</p> : (
          <form action={saveDestination} className="grid gap-3 max-w-xl border-t border-line pt-4" autoComplete="off">
            <h3 className="font-semibold text-sm">{(dests ?? []).some((d: any) => d.status !== "DISABLED") ? "Replace your payout details" : "Add your payout details"}</h3>
            <p className="text-xs text-inksoft">Your account number is encrypted before it is stored and is never shown again in full. Saving new details for a currency replaces the old ones and they must be verified again before any payout is sent. We never ask for card numbers, security codes or passwords.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="label" htmlFor="currency">Account currency</label><select id="currency" name="currency" className="input"><option value="PKR">PKR (Pakistani rupee account)</option><option value="USD">USD (dollar account)</option></select></div>
              <div><label className="label" htmlFor="country">Country of the bank</label><input id="country" name="country" required minLength={2} maxLength={60} className="input" defaultValue="Pakistan" /></div>
              <div><label className="label" htmlFor="account_holder">Account holder name</label><input id="account_holder" name="account_holder" required minLength={2} maxLength={120} className="input" aria-describedby="holder-help" /><p id="holder-help" className="text-xs text-inksoft mt-1">Exactly as it appears on the bank account.</p></div>
              <div><label className="label" htmlFor="bank_name">Bank name</label><input id="bank_name" name="bank_name" required minLength={2} maxLength={120} className="input" /></div>
              <div><label className="label" htmlFor="account_number">IBAN or account number</label><input id="account_number" name="account_number" required minLength={6} maxLength={40} className="input" inputMode="text" autoCapitalize="characters" spellCheck={false} aria-describedby="acct-help" /><p id="acct-help" className="text-xs text-inksoft mt-1">PKR accounts: your 24-character IBAN (starts with PK). The check digits are validated.</p></div>
              <div><label className="label" htmlFor="swift_bic">SWIFT/BIC <span className="text-inksoft">(required for USD)</span></label><input id="swift_bic" name="swift_bic" maxLength={11} className="input" spellCheck={false} /></div>
            </div>
            <SubmitButton>Save payout details</SubmitButton>
          </form>)}
      </section>

      <section className="card mb-6" aria-labelledby="how-payout-h">
        <h2 id="how-payout-h" className="font-serif font-semibold text-lg mb-2">How a payout moves</h2>
        <ol className="text-sm grid gap-1 list-decimal pl-5">
          <li><b>Eligible</b>: your link was verified and the customer's payment is confirmed. We aim to start within 12 hours.</li>
          <li><b>Being processed</b>: it needs a <i>verified</i> payout method; an administrator sends the bank transfer.</li>
          <li><b>Paid</b>: the transfer was sent and its reference recorded. Your bank decides when it arrives.</li>
          <li><b>On hold / failed</b>: a dispute, refund or bank problem. You are told why; nothing is lost.</li>
        </ol>
      </section>

      <h2 className="font-serif font-semibold text-xl mb-3">Your payouts</h2>
      {rows.length === 0 ? <EmptyState title="No payouts yet">A payout appears here after PostAtlas verifies a link you published. <Link className="underline" href="/publisher/orders">See your orders</Link>.</EmptyState> : (
        <ul className="grid gap-3">{rows.map((r) => { const l = Array.isArray(r.publisher_websites) ? r.publisher_websites[0] : r.publisher_websites; return (
          <li key={r.id} className="card text-sm flex flex-wrap justify-between gap-3"><div><b>{formatUsd(Number(r.amount).toFixed(2))}</b>{l?.domain ? ` · ${l.domain}` : ""}{r.kind === "replacement" ? " · replacement placement" : ""}
            <div className="text-xs text-inksoft">{STATUS_TEXT[r.status] ?? r.status}{r.status === "ELIGIBLE" && r.process_by ? ` · we aim to start by ${fmtDateTime(r.process_by)}` : ""}{r.hold_reason ? ` · ${r.hold_reason}` : ""}{r.status === "PAID" && r.payout_amount ? ` · sent ${r.payout_amount} ${r.payout_currency} on ${fmtDateTime(r.confirmed_at)}` : ""}</div></div></li>); })}</ul>)}
      <p className="text-xs text-inksoft mt-6">If a verified link later disappears you will be asked to restore it at no extra charge; restoring it does not create a second payout. Payouts for an order with an open dispute are held until it is resolved.</p>
    </div>
  );
}
