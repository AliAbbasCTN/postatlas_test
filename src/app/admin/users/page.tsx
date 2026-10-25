import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setPlatformRole, setUserDisabled } from "@/lib/actions/admin-users";
import { PageHeader, Pagination, parsePage, fmtDate } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import { grantableRoles } from "@/lib/permissions";

export const metadata = { title: "Users" };
const PAGE = 25;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; error?: string; done?: string }> }) {
  const sp = await searchParams;
  const me = await requireAdmin();
  const page = parsePage(sp.page);
  const term = (sp.q ?? "").replace(/[^a-zA-Z0-9@._+\- ]/g, "").slice(0, 80);
  let q = createAdminClient().from("profiles").select("id, email, full_name, platform_role, disabled, created_at", { count: "exact" }).order("created_at", { ascending: false });
  if (term) q = q.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const roles = grantableRoles(me.platformRole);
  return (
    <div>
      <PageHeader title="Users" subtitle="Platform roles are granted only here. Super admins are created directly in the database, never from the app." />
      <FormFeedback error={sp.error} success={sp.done ? "Saved." : undefined} />
      <form method="get" className="flex gap-3 items-end mb-5"><div><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={term} className="input" /></div><button className="btn">Search</button></form>
      <div className="table-wrap"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-inksoft border-b border-line"><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Joined</th><th className="p-3">Change</th></tr></thead>
        <tbody>{(data ?? []).map((u: any) => { const self = u.id === me.user.id; const locked = self || u.platform_role === "super_admin" || (u.platform_role === "admin" && me.platformRole !== "super_admin"); return (
          <tr key={u.id} className="border-b border-line last:border-0 align-top"><td className="p-3"><div className="font-medium">{u.full_name ?? "-"}</div><div className="text-xs text-inksoft break-all">{u.email}</div>{u.disabled && <StatusBadge status="suspended" label="Disabled" />}</td>
            <td className="p-3">{u.platform_role}</td><td className="p-3">{fmtDate(u.created_at)}</td>
            <td className="p-3">{locked ? <span className="text-xs text-inksoft">{self ? "That's you" : "Protected"}</span> : (
              <div className="flex flex-wrap gap-2"><form action={setPlatformRole} className="flex gap-2"><input type="hidden" name="user_id" value={u.id} /><label className="sr-only" htmlFor={`r${u.id}`}>Role</label><select id={`r${u.id}`} name="role" defaultValue={u.platform_role} className="input w-32">{roles.map((r) => <option key={r}>{r}</option>)}</select><button className="btn">Set</button></form>
                <form action={setUserDisabled}><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="disable" value={String(!u.disabled)} /><button className={u.disabled ? "btn" : "btn-danger"}>{u.disabled ? "Enable" : "Disable"}</button></form></div>)}</td></tr>); })}</tbody></table></div>
      <Pagination basePath="/admin/users" page={page} pageSize={PAGE} total={count ?? 0} params={{ q: term }} />
    </div>
  );
}
