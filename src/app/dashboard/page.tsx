import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextStep, fmtDate } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import { customerNextAction } from "@/lib/order-state";
import type { OrderStatus } from "@/lib/types";

export const metadata = { title: "Home" };

export default async function DashboardHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  // Customers never have to create an organisation: this guarantees a personal workspace for individual accounts.
  const { org } = await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const [sites, orders, opps, threads] = await Promise.all([
    supabase.from("websites").select("id, domain, last_audit_at").eq("organization_id", org.id).order("created_at", { ascending: true }).limit(25),
    supabase.from("orders").select("id, status, customer_price, created_at, target_url, publisher_websites(domain)").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("opportunities").select("id, status", { count: "exact" }).eq("organization_id", org.id).eq("status", "OPEN").limit(1),
    supabase.from("advice_threads").select("id, subject, awaiting").eq("organization_id", org.id).eq("status", "OPEN").eq("awaiting", "customer").limit(5)
  ]);
  const websites = sites.data ?? [];
  const orderRows: any[] = orders.data ?? [];
  const openOpps = opps.count ?? 0;

  // Pick the single most useful next step.
  const byStatus = (s: OrderStatus) => orderRows.find((o) => o.status === s);
  let step: { title: string; hint?: string; href: string; label: string; tone?: "primary" | "attention" };
  const issue = byStatus("ISSUE_DETECTED"), needsArticle = byStatus("PAID"), needsPayment = byStatus("PAYMENT_PENDING");
  const unanalyzed = websites.find((w: any) => !w.last_audit_at);
  if (issue) step = { title: "A placement has an issue", hint: "A recent check found a problem with one of your links.", href: `/dashboard/orders/${issue.id}`, label: "Review issue", tone: "attention" };
  else if (needsArticle) step = { title: "Submit your article", hint: "Your payment was approved. The publisher is waiting for your article.", href: `/dashboard/orders/${needsArticle.id}`, label: "Submit article", tone: "attention" };
  else if (needsPayment) step = { title: "Finish your order", hint: "Send payment, then enter your payment reference.", href: `/dashboard/orders/${needsPayment.id}`, label: "Submit payment details", tone: "attention" };
  else if (websites.length === 0) step = { title: "Add your website", hint: "Tell us which website you want to strengthen.", href: "/dashboard/websites", label: "Add your website" };
  else if (unanalyzed) step = { title: `Analyze ${unanalyzed.domain}`, hint: "We look at your pages and show where a link could help.", href: `/dashboard/websites/${unanalyzed.id}`, label: "Analyze website" };
  else if (openOpps > 0 && orderRows.length === 0) step = { title: "See where a link could help", hint: "These pages are worth a closer look.", href: "/dashboard/opportunities", label: "View opportunities" };
  else if (orderRows.length > 0) step = { title: "Everything is on track", hint: "Nothing needs your attention right now.", href: "/dashboard/placements", label: "View placements" };
  else step = { title: "Pick a page to strengthen", hint: "Choose a page on your website and we will show relevant publishers.", href: "/dashboard/opportunities", label: "View opportunities" };

  const active = orderRows.filter((o) => !["COMPLETED", "CANCELLED", "PUBLISHER_REJECTED"].includes(o.status)).slice(0, 5);
  return (
    <div>
      <h1 className="font-serif font-bold text-3xl mb-6">Home</h1>
      <FormFeedback error={sp.error} />
      <NextStep {...step} />
      {(threads.data ?? []).length > 0 && (
        <div className="card mb-8">
          <strong className="font-serif">You have a new response from PostAtlas</strong>
          <ul className="mt-2 text-sm">{(threads.data ?? []).map((t: any) => <li key={t.id}><Link className="text-verdigrisdark underline" href={`/dashboard/advice/${t.id}`}>{t.subject}</Link></li>)}</ul>
        </div>
      )}
      <section aria-labelledby="active-orders">
        <h2 id="active-orders" className="font-serif font-semibold text-xl mb-3">In progress</h2>
        {active.length === 0 ? <p className="text-inksoft text-sm">No active orders yet.</p> : (
          <ul className="grid gap-3">
            {active.map((o: any) => {
              const na = customerNextAction(o.status);
              const site = Array.isArray(o.publisher_websites) ? o.publisher_websites[0] : o.publisher_websites;
              return (
                <li key={o.id} className="card flex flex-wrap items-center justify-between gap-3">
                  <div><div className="font-medium">{site?.domain ?? "Publisher"}</div><div className="text-xs text-inksoft">Ordered {fmtDate(o.created_at)}</div></div>
                  <div className="flex items-center gap-3"><StatusBadge status={o.status} />{na && <Link className="btn" href={`/dashboard/orders/${o.id}`}>{na.label}</Link>}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="mt-8 text-sm text-inksoft">Not sure what to do? <Link href="/dashboard/advice/new" className="text-verdigrisdark underline">Ask for advice</Link> - no order needed.</p>
    </div>
  );
}
