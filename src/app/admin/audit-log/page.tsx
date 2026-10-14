import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, Pagination, parsePage, fmtDateTime } from "@/components/ui";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function AuditLog({ searchParams }: { searchParams: Promise<{ page?: string; action?: string }> }) {
  const sp = await searchParams;
  await requireAdmin();
  const page = parsePage(sp.page);
  const action = (sp.action ?? "").replace(/[^a-z._]/g, "").slice(0, 60);
  let q = createAdminClient().from("audit_logs").select("id, created_at, action, resource_type, resource_id, actor_id, metadata, profiles(email)", { count: "exact" }).order("created_at", { ascending: false });
  if (action) q = q.ilike("action", `${action}%`);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Append-only record of security-relevant actions. Passwords, tokens and payment references are never logged." />
      <form method="get" className="flex gap-3 items-end mb-5"><div><label className="label" htmlFor="action">Action starts with</label><input id="action" name="action" defaultValue={action} placeholder="payment." className="input" /></div><button className="btn">Filter</button></form>
      <div className="table-wrap"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Action</th><th className="p-3">Resource</th><th className="p-3">Details</th></tr></thead>
        <tbody>{(data ?? []).map((l: any) => { const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles; return (
          <tr key={l.id} className="border-b border-line last:border-0 align-top"><td className="p-3 whitespace-nowrap">{fmtDateTime(l.created_at)}</td><td className="p-3 break-all">{p?.email ?? (l.actor_id ? l.actor_id.slice(0, 8) : "system")}</td><td className="p-3 font-mono text-xs">{l.action}</td><td className="p-3 text-xs">{l.resource_type}<div className="break-all text-inksoft">{l.resource_id}</div></td><td className="p-3 text-xs font-mono break-all">{l.metadata ? JSON.stringify(l.metadata) : ""}</td></tr>); })}</tbody></table></div>
      <Pagination basePath="/admin/audit-log" page={page} pageSize={PAGE} total={count ?? 0} params={{ action }} />
    </div>
  );
}
