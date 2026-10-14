import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui";
import { readiness } from "@/lib/readiness";

export const metadata = { title: "Admin overview" };

export default async function AdminHome() {
  await requireAdmin();
  const db = createAdminClient();
  const c = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [pay, held, disputes, advice, pubApps, listings, issues] = await Promise.all([
    c(db.from("payments").select("id", { count: "exact", head: true }).eq("status", "PAYMENT_UNDER_REVIEW")),
    c(db.from("orders").select("id", { count: "exact", head: true }).eq("status", "CONTENT_SUBMITTED")),
    c(db.from("disputes").select("id", { count: "exact", head: true }).in("status", ["OPEN", "UNDER_REVIEW"])),
    c(db.from("advice_threads").select("id", { count: "exact", head: true }).eq("status", "OPEN").eq("awaiting", "team")),
    c(db.from("publisher_profiles").select("id", { count: "exact", head: true }).eq("approved", false)),
    c(db.from("publisher_websites").select("id", { count: "exact", head: true }).eq("status", "pending_review")),
    c(db.from("orders").select("id", { count: "exact", head: true }).in("status", ["ISSUE_DETECTED", "REPLACEMENT_REQUESTED", "PUBLISHER_REJECTED"]))
  ]);
  const items = [
    { label: "Payments to review", n: pay, href: "/admin/payments" },
    { label: "Articles held for review", n: held, href: "/admin/orders?status=CONTENT_SUBMITTED" },
    { label: "Open disputes", n: disputes, href: "/admin/disputes" },
    { label: "Advice requests awaiting a reply", n: advice, href: "/admin/advice" },
    { label: "Publisher applications", n: pubApps, href: "/admin/publishers" },
    { label: "Listings to review", n: listings, href: "/admin/publishers" },
    { label: "Orders with placement problems", n: issues, href: "/admin/orders?status=ISSUE_DETECTED" }
  ];
  return (
    <div>
      <PageHeader title="Overview" subtitle="What needs a person today." />
      {(() => { const bad = readiness().filter((r) => !r.ok && r.required); return bad.length > 0 ? (
        <section role="alert" className="card border-redsig mb-6" aria-labelledby="ready-h"><h2 id="ready-h" className="font-serif font-semibold text-lg text-redsig mb-2">Setup needed before launch ({bad.length})</h2>
          <ul className="grid gap-1 text-sm">{bad.map((r) => <li key={r.id}><b>✖ {r.label}:</b> {r.hint}</li>)}</ul></section>) : null; })()}
      <ul className="grid sm:grid-cols-2 gap-4">{items.map((i) => (
        <li key={i.label}><Link href={i.href} className="card block hover:border-ink"><div className="font-mono text-3xl">{i.n}</div><div className="text-sm text-inksoft">{i.label}</div></Link></li>))}</ul>
    </div>
  );
}
