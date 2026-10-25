import type { OrgRole } from "./types.ts";

// What each organisation role may do. Platform roles (publisher / admin /
// super_admin) are a separate axis and are only ever granted by an admin.
export const ORG_CAPABILITIES = {
  manageWebsites: ["owner", "seo_manager", "seo_specialist"],
  manageOrders: ["owner", "seo_manager"],          // create orders, submit payments, raise disputes
  submitContent: ["owner", "seo_manager", "content_manager"],
  askAdvice: ["owner", "seo_manager", "seo_specialist", "content_manager"],
  manageTeam: ["owner"]
} as const satisfies Record<string, readonly OrgRole[]>;

export type Capability = keyof typeof ORG_CAPABILITIES;

export function orgCan(role: OrgRole | null | undefined, cap: Capability): boolean {
  return !!role && (ORG_CAPABILITIES[cap] as readonly OrgRole[]).includes(role);
}

export const PLATFORM_ROLES = ["user", "publisher", "admin", "super_admin"] as const;
export type PlatformRoleName = (typeof PLATFORM_ROLES)[number];

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

// Which platform roles an actor may assign. Nobody assigns super_admin from the app.
export function grantableRoles(actorRole: string): PlatformRoleName[] {
  if (actorRole === "super_admin") return ["user", "publisher", "admin"];
  if (actorRole === "admin") return ["user", "publisher"];
  return [];
}

export function canChangeRoleOf(actorRole: string, targetCurrentRole: string, newRole: string): boolean {
  if (targetCurrentRole === "super_admin") return false;           // super admins are immutable from the app
  if (actorRole === "admin" && targetCurrentRole === "admin") return false; // admins cannot demote peers
  return grantableRoles(actorRole).includes(newRole as PlatformRoleName);
}
