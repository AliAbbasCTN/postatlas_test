"use server";

import { sendEmail } from "@/lib/email";
import { guarded } from "@/lib/action-utils";
import { clientIp, rateLimit, LIMITS } from "@/lib/rate-limit";
import { text, email, headerSafe } from "@/lib/validation";

// Contact messages are emailed to the operations mailbox; the address never reaches the browser.
export async function submitContact(formData: FormData) {
  return guarded(async () => {
    if (String(formData.get("company_website") ?? "")) return { ok: true as const }; // honeypot
    await rateLimit(`contact:${await clientIp()}`, LIMITS.contact.window, LIMITS.contact.max);
    const name = text(formData, "name", "Name", { max: 100 });
    const from = email(formData, "email");
    const subject = text(formData, "subject", "Subject", { max: 150 });
    const message = text(formData, "message", "Message", { min: 10, max: 5000, multiline: true });
    const to = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (!to) return { error: "This form is temporarily unavailable. Please try again later." };
    const result = await sendEmail({ to, subject: `Contact form: ${headerSafe(subject, 120)}`, text: `From: ${headerSafe(name, 100)} <${from}>\n\n${message}` });
    if (!result.ok) return { error: "Your message could not be sent right now. Please try again later." };
    return { ok: true as const };
  });
}
