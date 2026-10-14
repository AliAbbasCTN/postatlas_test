import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionError } from "@/lib/action-utils";
import { classifyDbError, DB_MESSAGES } from "@/lib/auth-errors";

export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    const ip = (fwd ? fwd.split(",")[0] : h.get("x-real-ip") ?? "").trim();
    return ip.slice(0, 64) || "unknown";
  } catch { return "unknown"; }
}

// Atomic counter in Postgres (rate_limit_hit), so limits hold across
// serverless instances. By default it fails CLOSED: if the limiter cannot be
// reached the action is refused rather than allowed unthrottled.
export async function rateLimit(key: string, windowSeconds: number, max: number, opts: { failOpen?: boolean } = {}): Promise<void> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key.slice(0, 200), p_window_seconds: windowSeconds, p_max: max });
    if (error) throw error;
    if (data === false) throw new ActionError("Too many requests. Please wait a few minutes and try again.");
  } catch (e) {
    if (e instanceof ActionError) throw e;
    // Safe diagnostics only: the failure category and Postgres/PostgREST code. Never the key (it holds IPs/emails) or any secret.
    const err = e as { code?: string; message?: string };
    const kind = classifyDbError(err);
    console.error("[rateLimit] limiter unavailable:", kind, err?.code ?? "no-code", kind === "other" ? (err?.message ?? "unknown").slice(0, 200) : "");
    if (!opts.failOpen) throw new ActionError(DB_MESSAGES[kind]);
  }
}

export const LIMITS = {
  login:        { window: 900,  max: 8 },
  signup:       { window: 3600, max: 5 },
  reset:        { window: 3600, max: 5 },
  contact:      { window: 3600, max: 5 },
  writeForUs:   { window: 86400, max: 3 },
  audit:        { window: 3600, max: 6 },
  order:        { window: 3600, max: 20 },
  payment:      { window: 3600, max: 10 },
  verify:       { window: 3600, max: 12 },
  advice:       { window: 600,  max: 20 },
  dispute:      { window: 3600, max: 10 }
} as const;
