import "server-only";
import { headerSafe } from "@/lib/validation";
import { siteUrl } from "@/lib/site";

// Thin email abstraction (Resend over HTTPS). When email is not configured it
// returns { ok: false } - it never pretends to have sent anything - and callers
// decide what that means. Recipients are validated and subjects are stripped
// of line breaks so user text can never inject headers.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

export type EmailResult = { ok: true } | { ok: false; reason: "not_configured" | "invalid_recipient" | "provider_error" | "unsupported_provider" };

export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<EmailResult> {
  const provider = process.env.EMAIL_PROVIDER;
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!provider || !apiKey || !from) return { ok: false, reason: "not_configured" };
  if (!EMAIL_RE.test(input.to) || input.to.length > 254) return { ok: false, reason: "invalid_recipient" };

  if (provider === "resend") {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [input.to], subject: headerSafe(input.subject, 200), text: input.text.slice(0, 50_000) }),
        signal: AbortSignal.timeout(8000)
      });
      return res.ok ? { ok: true } : { ok: false, reason: "provider_error" };
    } catch { return { ok: false, reason: "provider_error" }; }
  }
  return { ok: false, reason: "unsupported_provider" };
}

export const emailLink = (path: string) => `${siteUrl()}${path}`;
