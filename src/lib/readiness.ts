// Pure description of which required server settings are usable. Booleans and fixed hints only: never values, never key material.
import { payoutKeyValid } from "./crypto.ts";

export type Readiness = { id: string; label: string; ok: boolean; required: boolean; hint: string };

export function readiness(env: Record<string, string | undefined> = process.env): Readiness[] {
  const set = (k: string) => !!env[k]?.trim();
  const payoutKey = payoutKeyValid(env.PAYOUT_DATA_KEY);
  const cron = (env.CRON_SECRET ?? "").length >= 24;
  const email = set("EMAIL_PROVIDER") && set("EMAIL_API_KEY") && set("EMAIL_FROM_ADDRESS");
  const site = /^https:\/\/[^/]+$/.test(env.SITE_URL ?? "") || env.NODE_ENV !== "production";
  return [
    { id: "payout_key", label: "Payout encryption key", ok: payoutKey, required: true, hint: "PAYOUT_DATA_KEY must be 32 random bytes, base64. Without it publishers cannot save bank details." },
    { id: "cron", label: "Cron secret", ok: cron, required: true, hint: "CRON_SECRET (24+ characters) authorises the monitoring and finance jobs. Without it they refuse to run and payouts never start." },
    { id: "service_role", label: "Supabase service role key", ok: set("SUPABASE_SERVICE_ROLE_KEY"), required: true, hint: "Server-only. All writes use it." },
    { id: "site_url", label: "Canonical site URL (https)", ok: site, required: true, hint: "SITE_URL, https, no trailing slash." },
    { id: "admin_email", label: "Editorial/admin notification address", ok: set("ADMIN_NOTIFICATION_EMAIL"), required: true, hint: "Write for Us submissions and payment alerts are sent here." },
    { id: "email", label: "Email provider", ok: email, required: true, hint: "EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM_ADDRESS. Without them Write for Us shows an error and notifications are skipped." },
    { id: "fx_key", label: "Keyed FX provider", ok: set("FX_API_KEY"), required: false, hint: "Optional. Without it the keyless open.er-api.com feed is used." },
    { id: "seo", label: "SEO data provider", ok: (env.SEO_PROVIDER ?? "none") !== "none", required: false, hint: "Optional. Without a provider (SEO_PROVIDER plus its API key) link metrics show as not connected." }
  ];
}
