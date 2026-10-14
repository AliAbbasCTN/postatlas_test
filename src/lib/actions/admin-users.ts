"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionAdmin } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { uuid, oneOf } from "@/lib/validation";
import { PLATFORM_ROLES, canChangeRoleOf } from "@/lib/permissions";

// Platform roles are only ever changed here, by an admin, through the service role.
// The database also rejects role changes made with a user's own session (profiles_guard).
// 'super_admin' can never be granted or removed from the app - see the migration header.
export async function setPlatformRole(formData: FormData) {
  return withRedirect("/admin/users", async () => {
    const { user, platformRole } = await actionAdmin();
    const targetId = uuid(formData, "user_id");
    const newRole = oneOf(formData, "role", "Role", PLATFORM_ROLES);
    if (targetId === user.id) throw new ActionError("You cannot change your own role.");
    const db = createAdminClient();
    const { data: target } = await db.from("profiles").select("platform_role").eq("id", targetId).maybeSingle();
    if (!target) throw new ActionError("User not found.");
    if (!canChangeRoleOf(platformRole, target.platform_role, newRole)) throw new ActionError("You do not have permission to make that change.");
    const { error } = await db.from("profiles").update({ platform_role: newRole }).eq("id", targetId);
    if (error) throw new ActionError("Could not change the role.");
    await logAudit({ actorId: user.id, action: "user.role_changed", resourceType: "user", resourceId: targetId, metadata: { from: target.platform_role, to: newRole } });
    revalidatePath("/admin/users");
    redirect("/admin/users?done=1");
  });
}

export async function setUserDisabled(formData: FormData) {
  return withRedirect("/admin/users", async () => {
    const { user, platformRole } = await actionAdmin();
    const targetId = uuid(formData, "user_id");
    const disable = formData.get("disable") === "true";
    if (targetId === user.id) throw new ActionError("You cannot disable your own account.");
    const db = createAdminClient();
    const { data: target } = await db.from("profiles").select("platform_role").eq("id", targetId).maybeSingle();
    if (!target) throw new ActionError("User not found.");
    if (target.platform_role === "super_admin" || (target.platform_role === "admin" && platformRole !== "super_admin")) throw new ActionError("You do not have permission to change that account.");
    await db.from("profiles").update({ disabled: disable }).eq("id", targetId);
    if (disable) await db.auth.admin.signOut(targetId).catch(() => undefined);
    await logAudit({ actorId: user.id, action: disable ? "user.disabled" : "user.enabled", resourceType: "user", resourceId: targetId });
    revalidatePath("/admin/users");
    redirect("/admin/users?done=1");
  });
}
