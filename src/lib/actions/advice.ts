"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionWorkspace, assertWorkspaceCapability, actionAdmin, actionSession } from "@/lib/auth";
import { withRedirect, ActionError } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, optionalUuid } from "@/lib/validation";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { notifyUser, notifyStaff } from "@/lib/services/notify";
import { isAdminRole } from "@/lib/permissions";

const EMAIL_THROTTLE_MS = 10 * 60 * 1000;
const recently = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < EMAIL_THROTTLE_MS;

// Start a conversation. Context (website / opportunity / publisher / order) is attached only if it
// belongs to the customer's organisation (or is a public approved listing).
export async function startAdvice(formData: FormData) {
  return withRedirect("/dashboard/advice/new", async () => {
    const { user, org } = await actionWorkspace("askAdvice");
    await rateLimit(`advice:${user.id}`, LIMITS.advice.window, LIMITS.advice.max);
    const body = text(formData, "body", "Your question", { min: 5, max: 4000, multiline: true });
    const db = createAdminClient();

    const websiteId = optionalUuid(formData, "website_id");
    const opportunityId = optionalUuid(formData, "opportunity_id");
    const publisherId = optionalUuid(formData, "publisher_id");
    const orderId = optionalUuid(formData, "order_id");
    const ctx: Record<string, string | null> = { website_id: null, opportunity_id: null, publisher_website_id: null, order_id: null };
    let subject = text(formData, "subject", "Subject", { max: 140, optional: true });
    let label = "";

    if (opportunityId) {
      const { data } = await db.from("opportunities").select("id, website_id, page_url, websites(domain)").eq("id", opportunityId).eq("organization_id", org.id).maybeSingle();
      if (!data) throw new ActionError("That opportunity was not found.");
      ctx.opportunity_id = data.id; ctx.website_id = data.website_id; label = new URL(data.page_url).pathname || "/";
    }
    if (websiteId && !ctx.website_id) {
      const { data } = await db.from("websites").select("id, domain").eq("id", websiteId).eq("organization_id", org.id).maybeSingle();
      if (!data) throw new ActionError("That website was not found.");
      ctx.website_id = data.id; label = data.domain;
    }
    if (publisherId) {
      const { data } = await db.from("publisher_websites").select("id, domain").eq("id", publisherId).eq("status", "approved").maybeSingle();
      if (!data) throw new ActionError("That publisher was not found.");
      ctx.publisher_website_id = data.id; label = label ? `${label} / ${data.domain}` : data.domain;
    }
    if (orderId) {
      const { data } = await db.from("orders").select("id").eq("id", orderId).eq("organization_id", org.id).maybeSingle();
      if (!data) throw new ActionError("That order was not found.");
      ctx.order_id = data.id;
    }
    if (!subject) subject = label ? `Question about ${label}`.slice(0, 140) : "Question about my options";

    const { data: thread, error } = await db.from("advice_threads").insert({ organization_id: org.id, created_by: user.id, subject, ...ctx }).select("id").single();
    if (error || !thread) { console.error("[startAdvice]", error?.message); throw new ActionError("Could not start the conversation."); }
    await db.from("advice_messages").insert({ thread_id: thread.id, sender_id: user.id, sender_role: "customer", body });
    await db.from("advice_threads").update({ last_team_email_at: new Date().toISOString() }).eq("id", thread.id);
    await notifyStaff("New advice request", `${org.name}: ${subject}`, `/admin/advice/${thread.id}`);
    await logAudit({ actorId: user.id, organizationId: org.id, action: "advice.started", resourceType: "advice_thread", resourceId: thread.id });
    redirect(`/dashboard/advice/${thread.id}`);
  });
}

export async function postAdviceMessage(formData: FormData) {
  const raw = String(formData.get("thread_id") ?? "");
  const safeId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : "";
  return withRedirect(`/dashboard/advice/${safeId}`, async () => {
    const session = await actionSession();
    const threadId = uuid(formData, "thread_id");
    const body = text(formData, "body", "Message", { min: 1, max: 4000, multiline: true });
    await rateLimit(`advice:${session.user.id}`, LIMITS.advice.window, LIMITS.advice.max);
    const db = createAdminClient();
    const { data: thread } = await db.from("advice_threads").select("id, organization_id, created_by, subject, last_customer_email_at, last_team_email_at").eq("id", threadId).maybeSingle();
    if (!thread) throw new ActionError("Conversation not found.");

    const isTeam = isAdminRole(session.platformRole);
    if (!isTeam) {
      await assertWorkspaceCapability(session.user.id, thread.organization_id, "askAdvice", "Conversation not found.");
    }
    const now = new Date().toISOString();
    await db.from("advice_messages").insert({ thread_id: thread.id, sender_id: session.user.id, sender_role: isTeam ? "team" : "customer", body });
    const patch: Record<string, unknown> = { last_message_at: now, status: "OPEN", awaiting: isTeam ? "customer" : "team" };

    if (isTeam) {
      // In-app notice always; email only if we have not emailed this customer in the last 10 minutes.
      const emailOk = !recently(thread.last_customer_email_at);
      await notifyUser(thread.created_by, "advice.reply", { thread_id: thread.id },
        emailOk ? { subject: "You have a new response from PostAtlas", body: "The PostAtlas team replied to your question. Open the conversation to read it and continue.", path: `/dashboard/advice/${thread.id}` } : undefined);
      if (emailOk) patch.last_customer_email_at = now;
    } else if (!recently(thread.last_team_email_at)) {
      await notifyStaff("New message in an advice conversation", `${thread.subject}`, `/admin/advice/${thread.id}`);
      patch.last_team_email_at = now;
    }
    await db.from("advice_threads").update(patch).eq("id", thread.id);
    const back = isTeam ? `/admin/advice/${thread.id}` : `/dashboard/advice/${thread.id}`;
    revalidatePath(back);
    redirect(back);
  });
}

export async function closeAdviceThread(formData: FormData) {
  const raw = String(formData.get("thread_id") ?? "");
  return withRedirect(`/dashboard/advice/${/^[0-9a-f-]{36}$/i.test(raw) ? raw : ""}`, async () => {
    const session = await actionSession();
    const threadId = uuid(formData, "thread_id");
    const db = createAdminClient();
    const { data: thread } = await db.from("advice_threads").select("id, organization_id").eq("id", threadId).maybeSingle();
    if (!thread) throw new ActionError("Conversation not found.");
    const isTeam = isAdminRole(session.platformRole);
    if (!isTeam) await assertWorkspaceCapability(session.user.id, thread.organization_id, "askAdvice", "Conversation not found.");
    await db.from("advice_threads").update({ status: "CLOSED" }).eq("id", thread.id);
    redirect(isTeam ? `/admin/advice/${thread.id}` : `/dashboard/advice/${thread.id}`);
  });
}
