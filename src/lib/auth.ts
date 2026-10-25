import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionError } from "@/lib/action-utils";
import { isAdminRole, orgCan, type Capability } from "@/lib/permissions";
import { canHavePersonalWorkspace, isWorkspaceKind, pickActiveWorkspace, WORKSPACE_COOKIE, type Workspace } from "@/lib/workspace";
import type { OrgRole } from "@/lib/types";

// Every check here re-reads the database on the server. Nothing the browser
// sends (form field, query string, cookie value) is trusted for identity,
// role or workspace. Any failure to establish who the caller is - a
// Supabase error, a network error, a missing profile, a disabled account -
// results in "no session", never in access.
//
// OWNERSHIP MODEL
//   A customer's data belongs to a WORKSPACE (the `organizations` table, `kind` = personal | team).
//   - An individual customer uses their own personal workspace. The server creates it automatically the first
//     time they need it (requireWorkspace / actionWorkspace); the customer never sets anything up.
//   - A team workspace has members with roles (permissions.ts). Team membership is optional.
//   - "org" on the session is the ACTIVE workspace: where new things are created. Existing records are
//     authorised by the caller's membership in the workspace that OWNS the record (see assertWorkspaceCapability),
//     so being in several workspaces never exposes one to another.

export type OrgContext = Workspace;
export type Session = {
  user: User;
  platformRole: "user" | "publisher" | "admin" | "super_admin";
  /** The active workspace, or null if the account has none yet (it is provisioned lazily, see requireWorkspace). */
  org: OrgContext | null;
  /** Every workspace the caller really belongs to (membership order). */
  workspaces: Workspace[];
};

type MembershipRow = { role: string; organizations: { id: string; name: string; kind?: string } | { id: string; name: string; kind?: string }[] | null };

export const getSession = cache(async (): Promise<Session | null> => {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("platform_role, disabled").eq("id", data.user.id).maybeSingle();
    if (profileError || !profile || profile.disabled) return null;

    const { data: members } = await supabase
      .from("organization_members").select("role, organizations(id, name, kind)")
      .eq("user_id", data.user.id).order("created_at", { ascending: true }).limit(50);
    const workspaces: Workspace[] = [];
    for (const m of (members ?? []) as MembershipRow[]) {
      const o = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      if (!o) continue;
      workspaces.push({ id: o.id, name: o.name, role: m.role as OrgRole, kind: isWorkspaceKind(o.kind) ? o.kind : "team" });
    }
    let preferred: string | null = null;
    try { preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value ?? null; } catch { preferred = null; }
    return { user: data.user, platformRole: profile.platform_role, org: pickActiveWorkspace(workspaces, preferred), workspaces };
  } catch (e) {
    unstable_rethrow(e);   // Next control-flow signals (dynamic rendering, redirects) must not be mistaken for "signed out"
    console.error("[getSession]", e instanceof Error ? e.message : "unknown");
    return null;
  }
});

// Creates (once) and returns the caller's personal workspace. Server-side only: it runs with the service role
// but ONLY for the user id taken from the verified session, never from the browser.
async function provisionPersonalWorkspace(s: Session): Promise<Session & { org: OrgContext }> {
  if (!canHavePersonalWorkspace(s.platformRole)) throw new ActionError("This account type does not place orders.");
  const { data, error } = await createAdminClient().rpc("ensure_personal_workspace", { p_user: s.user.id });
  if (error || typeof data !== "string") {
    console.error("[ensure_personal_workspace]", error?.message ?? "no id returned");
    throw new ActionError("We could not prepare your account right now. Please try again.");
  }
  const ws: Workspace = { id: data, name: "Personal workspace", role: "owner", kind: "personal" };
  return { ...s, org: ws, workspaces: [...s.workspaces, ws] };
}

// ---- page / layout guards (redirect) --------------------------------------

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

// Customer pages. Guarantees an active workspace: a customer with no team gets their personal one automatically,
// so nobody is ever sent to "create an organisation first". Staff accounts go to their own area.
export async function requireWorkspace(): Promise<Session & { org: OrgContext }> {
  const s = await requireSession();
  if (s.org) return s as Session & { org: OrgContext };
  if (!canHavePersonalWorkspace(s.platformRole)) redirect("/admin");
  try {
    return await provisionPersonalWorkspace(s);
  } catch (e) {
    if (e instanceof ActionError) redirect(`/dashboard?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!isAdminRole(s.platformRole)) redirect("/dashboard");
  return s;
}

export async function requireSuperAdmin(): Promise<Session> {
  const s = await requireSession();
  if (s.platformRole !== "super_admin") redirect("/dashboard");
  return s;
}

export async function requirePublisher(): Promise<Session> {
  const s = await requireSession();
  if (s.platformRole !== "publisher") redirect("/dashboard");
  return s;
}

// ---- action guards (throw ActionError, never redirect) ---------------------

export async function actionSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new ActionError("Please sign in to continue.");
  return s;
}

// For actions that CREATE something in the caller's active workspace (add a website, place an order, ask for advice).
// A customer without a team is provisioned a personal workspace here; the capability check still applies, so a
// team "viewer" cannot create anything.
export async function actionWorkspace(cap: Capability): Promise<Session & { org: OrgContext }> {
  let s = await actionSession();
  if (!s.org) s = await provisionPersonalWorkspace(s);
  if (!s.org || !orgCan(s.org.role, cap)) throw new ActionError("Your role in this workspace does not allow that action.");
  return s as Session & { org: OrgContext };
}

// For actions on an EXISTING record (an order, a website, an opportunity). Authorises by the caller's membership
// in the workspace that owns the record, not by whichever workspace happens to be active. The error is deliberately
// the same whether the record is missing or belongs to someone else.
export async function assertWorkspaceCapability(userId: string, workspaceId: string | null | undefined, cap: Capability | null, notFound = "Not found."): Promise<OrgRole> {
  if (!workspaceId) throw new ActionError(notFound);
  const { data } = await createAdminClient().from("organization_members").select("role")
    .eq("organization_id", workspaceId).eq("user_id", userId).maybeSingle();
  const role = data?.role as OrgRole | undefined;
  if (!role) throw new ActionError(notFound);
  if (cap && !orgCan(role, cap)) throw new ActionError("Your role in this workspace does not allow that action.");
  return role;
}

export async function actionAdmin(): Promise<Session> {
  const s = await actionSession();
  if (!isAdminRole(s.platformRole)) throw new ActionError("You do not have permission to do that.");
  return s;
}

export async function actionSuperAdmin(): Promise<Session> {
  const s = await actionSession();
  if (s.platformRole !== "super_admin") throw new ActionError("You do not have permission to do that.");
  return s;
}

export async function actionPublisher(): Promise<Session> {
  const s = await actionSession();
  if (s.platformRole !== "publisher") throw new ActionError("You do not have permission to do that.");
  return s;
}

// Kept for pages that only need the current user (e.g. public pages that show
// a "Save" button when signed in).
export async function getCurrentUser() {
  return (await getSession())?.user ?? null;
}
