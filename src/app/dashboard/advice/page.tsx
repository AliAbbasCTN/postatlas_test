import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, fmtDateTime } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = { title: "Ask for advice" };

export default async function AdviceList() {
  await requireWorkspace();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("advice_threads").select("id, subject, status, awaiting, last_message_at").order("last_message_at", { ascending: false }).limit(50);
  const rows: any[] = data ?? [];
  return (
    <div>
      <PageHeader title="Ask for advice" subtitle="Talk to the PostAtlas team about your website and your options. No order needed." action={<Link className="btn-primary" href="/dashboard/advice/new">New question</Link>} />
      {rows.length === 0 ? <EmptyState title="No conversations yet" action={{ href: "/dashboard/advice/new", label: "Ask a question" }}>Not sure what makes sense for your website? Ask us.</EmptyState> : (
        <ul className="grid gap-3">{rows.map((t) => (
          <li key={t.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div><Link href={`/dashboard/advice/${t.id}`} className="font-serif font-semibold">{t.subject}</Link><div className="text-xs text-inksoft">Last message {fmtDateTime(t.last_message_at)}</div></div>
            {t.status === "CLOSED" ? <StatusBadge status="NEEDS_REVIEW" label="Closed" /> : t.awaiting === "customer" ? <StatusBadge status="PAID" label="New response" /> : <StatusBadge status="PENDING" label="Waiting for our reply" />}
          </li>))}
        </ul>
      )}
    </div>
  );
}
