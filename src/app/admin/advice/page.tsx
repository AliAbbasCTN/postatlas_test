import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, EmptyState, Pagination, parsePage, fmtDateTime } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Advice requests" };
const PAGE = 25;

export default async function AdminAdvice({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const page = parsePage(sp.page);
  const { data, count } = await createAdminClient().from("advice_threads").select("id, subject, status, awaiting, last_message_at, organizations(name)", { count: "exact" })
    .order("awaiting", { ascending: false }).order("last_message_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Advice requests" subtitle="Pre-purchase questions from customers. Separate from disputes." />
      {rows.length === 0 ? <EmptyState title="No conversations yet" /> : (
        <ul className="grid gap-3">{rows.map((t) => { const org = Array.isArray(t.organizations) ? t.organizations[0] : t.organizations; return (
          <li key={t.id} className="card flex flex-wrap items-center justify-between gap-3"><div><Link href={`/admin/advice/${t.id}`} className="font-serif font-semibold">{t.subject}</Link><div className="text-xs text-inksoft">{org?.name} · {fmtDateTime(t.last_message_at)}</div></div>
            {t.status === "CLOSED" ? <StatusBadge status="NEEDS_REVIEW" label="Closed" /> : t.awaiting === "team" ? <StatusBadge status="PENDING" label="Needs a reply" /> : <StatusBadge status="PAID" label="Replied" />}</li>); })}</ul>)}
      <Pagination basePath="/admin/advice" page={page} pageSize={PAGE} total={count ?? 0} />
    </div>
  );
}
