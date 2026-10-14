import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// NOT a server action (this file has no "use server"), so the browser cannot call it directly.
// Joins pending invitations only for an address the caller has already proven they own
// (email confirmed by Supabase). Callers pass values taken from the verified session, never from a form.
export async function acceptPendingInvitations(userId: string, email: string | undefined, confirmed: boolean) {
  if (!email || !confirmed) return;
  const db = createAdminClient();
  const { data: invites } = await db.from("organization_invitations").select("id, organization_id, role").ilike("email", email).eq("status", "PENDING");
  for (const inv of invites ?? []) {
    const { error } = await db.from("organization_members").insert({ organization_id: inv.organization_id, user_id: userId, role: inv.role });
    if (!error || error.code === "23505") await db.from("organization_invitations").update({ status: "ACCEPTED" }).eq("id", inv.id);
  }
}
