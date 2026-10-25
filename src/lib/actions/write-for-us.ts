"use server";

import { sendEmail } from "@/lib/email";
import { guarded } from "@/lib/action-utils";
import { clientIp, rateLimit, LIMITS } from "@/lib/rate-limit";
import { text, email, headerSafe, countWords, containsActiveMarkup, ValidationError } from "@/lib/validation";
import { scanContentPolicy, describeFlags } from "@/lib/content-policy";

// Deliberately does NOT store anything in the database: submissions are emailed to the
// editorial mailbox for a human to review. Nothing is ever auto-published.
export async function submitWriteForUs(formData: FormData) {
  return guarded(async () => {
    if (String(formData.get("company_website_hp") ?? "")) return { ok: true as const }; // honeypot
    await rateLimit(`wfu:${await clientIp()}`, LIMITS.writeForUs.window, LIMITS.writeForUs.max);
    const name = text(formData, "name", "Name", { max: 100 });
    const from = email(formData, "email");
    const title = text(formData, "article_title", "Article title", { min: 5, max: 200 });
    const article = text(formData, "article", "Article", { max: 60_000, multiline: true });
    const words = countWords(article);
    if (words < 1000) throw new ValidationError(`Articles must be at least 1,000 words (yours is about ${words}).`);
    if (words > 6000) throw new ValidationError("Articles can be at most 6,000 words.");
    const optional = (k: string, label: string, max = 500) => text(formData, k, label, { max, optional: true, multiline: true }) || "-";
    const fields = {
      company: optional("company", "Company", 150), job: optional("job_title", "Job title", 150), website: optional("website", "Website", 300),
      topic: optional("topic", "Topic", 200), category: optional("category", "Category", 100), description: optional("description", "Description", 1000),
      refs: optional("references", "Reference URLs", 1500), why: optional("why_useful", "Why useful", 1000), bio: optional("bio", "Author bio", 1000)
    };
    if ([title, article, ...Object.values(fields)].some(containsActiveMarkup)) throw new ValidationError("Scripts and active HTML are not allowed. Please submit plain text.");
    const flags = scanContentPolicy(title, article);
    const to = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (!to) return { error: "Submissions are temporarily unavailable. Please try again later." };
    const body = [
      `Author: ${headerSafe(name, 100)} <${from}>`, `Company: ${fields.company}`, `Job title: ${fields.job}`, `Website: ${fields.website}`,
      `Article title: ${title}`, `Topic: ${fields.topic}`, `Category: ${fields.category}`, `Description: ${fields.description}`,
      `Reference URLs: ${fields.refs}`, `Why useful: ${fields.why}`, `Word count: ${words}`,
      flags.length ? `POLICY FLAGS: ${describeFlags(flags)}` : "Policy flags: none", "", "----- ARTICLE -----", article, "", "----- AUTHOR BIO -----", fields.bio
    ].join("\n");
    const result = await sendEmail({ to, subject: `Write for Us submission: ${headerSafe(title, 120)}`, text: body });
    if (!result.ok) return { error: "Your submission could not be sent right now. Please try again later." };
    return { ok: true as const };
  });
}
