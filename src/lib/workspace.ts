import type { OrgRole } from "./types.ts";

// A "workspace" is whatever owns a customer's websites, opportunities and orders. It is either
//   - "personal": a private single-owner workspace the server creates automatically the first time an
//                 individual customer needs one (the customer never names or sets it up), or
//   - "team":     an organisation/agency a customer created or was invited to, with member roles.
// Pure helpers only (no I/O) so the selection rules can be unit tested.

export type WorkspaceKind = "team" | "personal";
export type Workspace = { id: string; name: string; role: OrgRole; kind: WorkspaceKind };

// Name of the cookie that remembers which workspace a person last switched to. It is only a PREFERENCE:
// pickActiveWorkspace() ignores it unless the id is one of the caller's real memberships, so forging it
// can never reach a workspace the caller does not belong to.
export const WORKSPACE_COOKIE = "pa_workspace";

// Platform roles that may own a personal workspace. Admin and super-admin accounts are staff accounts:
// they never get a customer workspace.
export function canHavePersonalWorkspace(platformRole: string): boolean {
  return platformRole === "user" || platformRole === "publisher";
}

export function isWorkspaceKind(v: unknown): v is WorkspaceKind {
  return v === "team" || v === "personal";
}

// Which workspace is "active" (used when CREATING things: a website, an order, an advice request).
//   1. the preferred id, if and only if the caller really is a member of it;
//   2. otherwise the earliest team workspace (someone who joined a team is usually there to work in it);
//   3. otherwise their personal workspace;
//   4. otherwise none.
// `list` must already be in membership order (oldest first).
export function pickActiveWorkspace(list: Workspace[], preferredId?: string | null): Workspace | null {
  if (preferredId) {
    const hit = list.find((w) => w.id === preferredId);
    if (hit) return hit;
  }
  return list.find((w) => w.kind === "team") ?? list.find((w) => w.kind === "personal") ?? null;
}

// Display name: a personal workspace is simply "Personal"; a team shows its name.
export function workspaceLabel(w: Pick<Workspace, "kind" | "name">): string {
  return w.kind === "personal" ? "Personal account" : w.name;
}
