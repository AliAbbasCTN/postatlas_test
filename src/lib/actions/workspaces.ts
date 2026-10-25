"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSession, assertWorkspaceCapability } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { canHavePersonalWorkspace, WORKSPACE_COOKIE } from "@/lib/workspace";

const BACK = "/dashboard/settings";
const MAX_OWNED_TEAMS = 5;

async function rememberWorkspace(id: string) {
  (await cookies()).set(WORKSPACE_COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365
  });
}

// OPTIONAL. Creates a team (an organisation or agency) with the caller as its owner, so they can invite colleagues.
// Nothing in the customer journey requires this: individual customers buy from their personal workspace.
export async function createTeam(formData: FormData) {
  return withRedirect(BACK, async () => {
    const session = await actionSession();
    if (!canHavePersonalWorkspace(session.platformRole)) throw new ActionError("This account type cannot create a customer team.");
    await rateLimit(`team-create:${session.user.id}`, 3600, 5);
    const name = text(formData, "team_name", "Team name", { min: 2, max: 100 });
    const db = createAdminClient();
    const { count } = await db.from("organization_members").select("organization_id, organizations!inner(kind)", { count: "exact", head: true })
      .eq("user_id", session.user.id).eq("role", "owner").eq("organizations.kind", "team");
    if ((count ?? 0) >= MAX_OWNED_TEAMS) throw new ActionError(`You can own up to ${MAX_OWNED_TEAMS} teams.`);

    const { data: org, error } = await db.from("organizations").insert({ name, kind: "team" }).select("id").single();
    if (error || !org) { console.error("[createTeam]", error?.message); throw new ActionError("Could not create the team."); }
    const { error: memberError } = await db.from("organization_members").insert({ organization_id: org.id, user_id: session.user.id, role: "owner" });
    if (memberError) {
      console.error("[createTeam] member:", memberError.message);
      await db.from("organizations").delete().eq("id", org.id);          // never leave an ownerless team behind
      throw new ActionError("Could not create the team.");
    }
    await logAudit({ actorId: session.user.id, organizationId: org.id, action: "team.created", resourceType: "organization", resourceId: org.id });
    await rememberWorkspace(org.id);
    revalidatePath("/dashboard", "layout");
    redirect(`${BACK}?notice=${encodeURIComponent("Team created. You can invite people below.")}`);
  });
}

// Switch the active workspace (where new websites/orders are created). The id from the browser is only a request:
// membership is re-verified against the database, so a forged id cannot select a workspace the caller is not in.
export async function switchWorkspace(formData: FormData) {
  return withRedirect(BACK, async () => {
    const session = await actionSession();
    let wanted = String(formData.get("workspace_id") ?? "");
    if (wanted === "personal") {
      // First use of the personal workspace: the server creates it (idempotent) for the verified caller only.
      if (!canHavePersonalWorkspace(session.platformRole)) throw new ActionError("Workspace not found.");
      const { data, error } = await createAdminClient().rpc("ensure_personal_workspace", { p_user: session.user.id });
      if (error || typeof data !== "string") { console.error("[switchWorkspace]", error?.message); throw new ActionError("Could not open your personal account."); }
      wanted = data;
    }
    if (!/^[0-9a-f-]{36}$/i.test(wanted)) throw new ActionError("Workspace not found.");
    await assertWorkspaceCapability(session.user.id, wanted, null, "Workspace not found.");   // membership only: every role may switch
    await rememberWorkspace(wanted);
    revalidatePath("/dashboard", "layout");
    redirect("/dashboard");
  });
}
