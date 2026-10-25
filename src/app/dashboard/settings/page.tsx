import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteTeammate, revokeInvitation, acceptInvitation, declineInvitation } from "@/lib/actions/team";
import { createTeam, switchWorkspace } from "@/lib/actions/workspaces";
import { canHavePersonalWorkspace, workspaceLabel } from "@/lib/workspace";
import { PageHeader } from "@/components/ui";
import { FormFeedback } from "@/components/FormFeedback";
import { StatusBadge } from "@/components/StatusBadge";
import { orgCan } from "@/lib/permissions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; invited?: string; notice?: string; joined?: string; declined?: string }> }) {
  const sp = await searchParams;
  const { user, org, platformRole, workspaces } = await requireSession();
  const isTeam = org?.kind === "team";
  const hasPersonal = workspaces.some((w) => w.kind === "personal");
  const db = createAdminClient();
  // Invitations addressed to the signed-in, confirmed email only.
  const mine = user.email && user.email_confirmed_at
    ? (await db.from("organization_invitations").select("id, role, organizations(name)").ilike("email", user.email).eq("status", "PENDING")).data ?? [] : [];
  // Members and pending invitations are read for THIS organisation only (server decides the org).
  const members = org && isTeam ? (await db.from("organization_members").select("user_id, role, profiles(full_name, email)").eq("organization_id", org.id)).data ?? [] : [];
  const sent = org && isTeam && orgCan(org.role, "manageTeam") ? (await db.from("organization_invitations").select("id, email, role").eq("organization_id", org.id).eq("status", "PENDING")).data ?? [] : [];
  const success = sp.joined ? "You joined the organization." : sp.declined ? "Invitation declined." : sp.invited ? "Invitation sent." : undefined;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle={org ? workspaceLabel(org) : "Your account"} />
      <FormFeedback error={sp.error} success={success} />
      {sp.notice && <FormFeedback success={sp.notice} />}

      <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-2">Your account</h2>
        <p className="text-sm">{user.email}</p><p className="text-xs text-inksoft mt-1">Account type: {platformRole === "user" ? "Customer" : platformRole.replace("_", " ")}</p></section>

      {mine.length > 0 && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-3">Invitations for you</h2>
          <ul className="grid gap-3">{mine.map((i: any) => { const o = Array.isArray(i.organizations) ? i.organizations[0] : i.organizations; return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>Join <b>{o?.name}</b> as {i.role.replace("_", " ")}</span>
              <span className="flex gap-2"><form action={acceptInvitation}><input type="hidden" name="invitation_id" value={i.id} /><button className="btn-primary">Accept</button></form>
                <form action={declineInvitation}><input type="hidden" name="invitation_id" value={i.id} /><button className="btn">Decline</button></form></span></li>); })}</ul></section>
      )}

      {canHavePersonalWorkspace(platformRole) && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-1">Where your orders live</h2>
          <p className="text-sm text-inksoft mb-3">You can buy placements as an individual with no setup. Create a team only if you want to work with colleagues or clients.</p>
          <ul className="grid gap-2 text-sm mb-4">
            {workspaces.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3"><span>{workspaceLabel(w)}{w.kind === "team" ? <span className="text-inksoft"> · {w.role.replace("_", " ")}</span> : null}{org?.id === w.id ? <span className="text-inksoft"> · in use</span> : null}</span>
                {org?.id !== w.id && <form action={switchWorkspace}><input type="hidden" name="workspace_id" value={w.id} /><button className="btn">Switch</button></form>}</li>
            ))}
            {!hasPersonal && workspaces.length > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-3"><span>Personal account</span><form action={switchWorkspace}><input type="hidden" name="workspace_id" value="personal" /><button className="btn">Switch</button></form></li>
            )}
          </ul>
          <form action={createTeam} className="grid gap-3 sm:grid-cols-[1fr_auto] items-end border-t border-line pt-4">
            <div><label className="label" htmlFor="team_name">Create a team (optional)</label><input id="team_name" name="team_name" required minLength={2} maxLength={100} className="input" placeholder="e.g. Acme Marketing" /></div>
            <button className="btn-primary">Create team</button>
          </form>
        </section>
      )}

      {org && isTeam && (
        <section className="card mb-6"><h2 className="font-serif font-semibold text-lg mb-3">Team</h2>
          <ul className="grid gap-2 text-sm mb-4">{members.map((m: any) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return (
            <li key={m.user_id} className="flex justify-between gap-3"><span>{p?.full_name ?? p?.email ?? "Member"}{p?.full_name && p?.email ? <span className="text-inksoft"> · {p.email}</span> : null}</span><StatusBadge status="NEEDS_REVIEW" label={m.role.replace("_", " ")} /></li>); })}</ul>
          {sent.length > 0 && <><h3 className="text-sm font-medium mb-2">Pending invitations</h3><ul className="grid gap-2 text-sm mb-4">{sent.map((i: any) => (
            <li key={i.id} className="flex justify-between gap-3"><span>{i.email} · {i.role.replace("_", " ")}</span><form action={revokeInvitation}><input type="hidden" name="invitation_id" value={i.id} /><button className="text-inksoft underline">Revoke</button></form></li>))}</ul></>}
          {orgCan(org.role, "manageTeam") && (
            <form action={inviteTeammate} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] items-end border-t border-line pt-4">
              <div><label className="label" htmlFor="email">Invite by email</label><input id="email" type="email" name="email" required maxLength={254} className="input" /></div>
              <div><label className="label" htmlFor="role">Role</label><select id="role" name="role" className="input"><option value="seo_manager">Manager</option><option value="seo_specialist">Specialist</option><option value="content_manager">Content</option><option value="viewer">Viewer</option></select></div>
              <button className="btn-primary">Invite</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
