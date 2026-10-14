"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionWorkspace, actionSession } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { siteUrl } from "@/lib/site";
import { email as emailField, oneOf, uuid } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";

const BACK = "/dashboard/settings";
const INVITABLE = ["seo_manager", "seo_specialist", "content_manager", "viewer"] as const;

export async function inviteTeammate(formData: FormData) {
  return withRedirect(BACK, async () => {
    const { user, org } = await actionWorkspace("manageTeam");
    // Only a team can have members. A personal workspace is a private single-owner space.
    if (org.kind !== "team") throw new ActionError("Create a team first, then invite people to it.");
    await rateLimit(`invite:${user.id}`, 3600, 20);
    const email = emailField(formData, "email");
    const role = oneOf(formData, "role", "Role", INVITABLE);

    const db = createAdminClient();
    const { error } = await db.from("organization_invitations").insert({ organization_id: org.id, email, role, invited_by: user.id });
    if (error) {
      if (error.code === "23505") throw new ActionError("There is already a pending invitation for that email.");
      console.error("[invite]", error.message);
      throw new ActionError("Could not create the invitation.");
    }
    const sent = await sendEmail({
      to: email,
      subject: `You've been invited to join ${org.name} on PostAtlas`,
      text: `You've been invited to join ${org.name} on PostAtlas as ${role.replace("_", " ")}. Sign up or log in with this exact email address at ${siteUrl()}/signup and confirm your email to join.`
    });
    await logAudit({ actorId: user.id, organizationId: org.id, action: "team.invited", resourceType: "organization_invitation", metadata: { role, email_sent: sent.ok } });
    revalidatePath(BACK);
    redirect(sent.ok ? `${BACK}?invited=1` : `${BACK}?invited=1&notice=${encodeURIComponent("Invitation saved, but the email could not be sent. Share the sign-up link with them directly.")}`);
  });
}

export async function revokeInvitation(formData: FormData) {
  return withRedirect(BACK, async () => {
    const { user, org } = await actionWorkspace("manageTeam");
    if (org.kind !== "team") throw new ActionError("Create a team first, then invite people to it.");
    const id = uuid(formData, "invitation_id");
    // org_id filter: an owner can only revoke invitations that belong to their own organisation.
    await createAdminClient().from("organization_invitations").update({ status: "REVOKED" }).eq("id", id).eq("organization_id", org.id).eq("status", "PENDING");
    await logAudit({ actorId: user.id, organizationId: org.id, action: "team.invitation_revoked", resourceType: "organization_invitation", resourceId: id });
    revalidatePath(BACK);
    redirect(BACK);
  });
}

// Lets an existing user accept an invitation addressed to their own, CONFIRMED email.
export async function acceptInvitation(formData: FormData) {
  return withRedirect(BACK, async () => {
    const { user } = await actionSession();
    const id = uuid(formData, "invitation_id");
    if (!user.email || !user.email_confirmed_at) throw new ActionError("Please confirm your email address first.");
    const db = createAdminClient();
    const { data: inv } = await db.from("organization_invitations").select("id, organization_id, email, role, status").eq("id", id).maybeSingle();
    if (!inv || inv.status !== "PENDING") throw new ActionError("This invitation is no longer available.");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new ActionError("This invitation was sent to a different email address.");
    const { error } = await db.from("organization_members").insert({ organization_id: inv.organization_id, user_id: user.id, role: inv.role });
    if (error && error.code !== "23505") throw new ActionError("Could not join the organization.");
    await db.from("organization_invitations").update({ status: "ACCEPTED" }).eq("id", inv.id);
    await logAudit({ actorId: user.id, organizationId: inv.organization_id, action: "team.invitation_accepted", resourceType: "organization_invitation", resourceId: inv.id });
    revalidatePath(BACK);
    redirect(`${BACK}?joined=1`);
  });
}

export async function declineInvitation(formData: FormData) {
  return withRedirect(BACK, async () => {
    const { user } = await actionSession();
    const id = uuid(formData, "invitation_id");
    const db = createAdminClient();
    const { data: inv } = await db.from("organization_invitations").select("id, email, status").eq("id", id).maybeSingle();
    if (inv && inv.status === "PENDING" && user.email && inv.email.toLowerCase() === user.email.toLowerCase()) {
      await db.from("organization_invitations").update({ status: "REVOKED" }).eq("id", id);
    }
    revalidatePath(BACK);
    redirect(`${BACK}?declined=1`);
  });
}
