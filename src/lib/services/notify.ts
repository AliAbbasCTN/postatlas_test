import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLink } from "@/lib/email";

// In-app notification (always) + email (best effort). Email failure never
// fails the action that caused it and is never reported as success.
export async function notifyUser(
  userId: string,
  eventType: string,
  payload: Record<string, string | number | boolean | null>,
  email?: { subject: string; body: string; path: string }
): Promise<{ emailed: boolean }> {
  const db = createAdminClient();
  await db.from("notifications").insert({ user_id: userId, event_type: eventType, payload });
  if (!email) return { emailed: false };
  const { data: profile } = await db.from("profiles").select("email, disabled").eq("id", userId).maybeSingle();
  if (!profile?.email || profile.disabled) return { emailed: false };
  const res = await sendEmail({
    to: profile.email,
    subject: email.subject,
    text: `${email.body}\n\nOpen in PostAtlas: ${emailLink(email.path)}\n\nYou are receiving this because of activity on your PostAtlas account.`
  });
  return { emailed: res.ok };
}

export async function notifyMany(userIds: string[], eventType: string, payload: Record<string, string | number | boolean | null>, email?: { subject: string; body: string; path: string }) {
  for (const id of new Set(userIds)) await notifyUser(id, eventType, payload, email).catch((e) => console.error("[notify]", e instanceof Error ? e.message : "unknown"));
}

// Staff alert: goes to the configured operations mailbox. The address stays server-side.
export async function notifyStaff(subject: string, body: string, path: string) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) return false;
  const res = await sendEmail({ to, subject, text: `${body}\n\n${emailLink(path)}` });
  return res.ok;
}
