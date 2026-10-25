// Pure helpers (no server-only imports, so they are unit-testable) that tell apart the different reasons an
// authentication step can fail. The UI message is chosen from the KIND, and the KIND plus a safe error code is
// logged server-side. Messages, passwords, tokens and keys are never logged by these helpers.

export type AuthFailureKind =
  | "invalid_credentials" | "email_not_confirmed" | "rate_limited" | "email_rate_limited"
  | "weak_password" | "already_registered" | "network" | "service";

type AuthLike = { status?: number | null; code?: string | null; message?: string | null; name?: string | null } | null | undefined;

export function classifyAuthError(e: AuthLike): AuthFailureKind {
  const code = (e?.code ?? "").toLowerCase();
  const msg = (e?.message ?? "").toLowerCase();
  const status = e?.status ?? 0;
  if (code === "email_not_confirmed") return "email_not_confirmed";
  if (code === "over_email_send_rate_limit" || /email rate limit/.test(msg)) return "email_rate_limited";
  if (code === "over_request_rate_limit" || status === 429 || /rate limit|too many requests/.test(msg)) return "rate_limited";
  if (code === "weak_password" || /password (is )?(too )?(weak|short)|password should/.test(msg)) return "weak_password";
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|already exists/.test(msg)) return "already_registered";
  if (code === "invalid_credentials" || status === 400 || status === 401) return "invalid_credentials";
  if (e?.name === "AuthRetryableFetchError" || e?.status === 0 || status >= 500 || /fetch failed|network|timeout|econn|enotfound/.test(msg)) return "network";
  return "service";
}

export const AUTH_MESSAGES: Record<AuthFailureKind, string> = {
  invalid_credentials: "Invalid email or password.",
  email_not_confirmed: "Please confirm your email address first - check your inbox.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  email_rate_limited: "We have sent several emails to this address or network recently. Please wait a few minutes and try again.",
  weak_password: "That password is too weak. Please choose a longer, less common one.",
  already_registered: "An account with this email already exists. Please log in instead.",
  network: "We could not reach the sign-in service. Please try again in a moment.",
  service: "Sign-in is temporarily unavailable. Please try again in a moment."
};

export type DbFailureKind = "missing_object" | "permission" | "config" | "network" | "other";

type DbLike = { code?: string | null; message?: string | null } | null | undefined;

// Postgres / PostgREST codes: 42883 undefined_function, 42P01 undefined_table, 42703 undefined_column,
// PGRST202 function not in schema cache, PGRST205 table not in schema cache, 42501 insufficient_privilege.
export function classifyDbError(e: DbLike): DbFailureKind {
  const code = e?.code ?? "";
  const msg = (e?.message ?? "").toLowerCase();
  if (["42883", "42P01", "42703", "PGRST202", "PGRST205"].includes(code) || /could not find the function|schema cache|does not exist/.test(msg)) return "missing_object";
  if (code === "42501" || /permission denied|row-level security/.test(msg)) return "permission";
  if (/not configured|invalid api key|jwt|apikey/.test(msg)) return "config";
  if (/fetch failed|network|timeout|econn|enotfound/.test(msg)) return "network";
  return "other";
}

export const DB_MESSAGES: Record<DbFailureKind, string> = {
  missing_object: "This service is not fully set up yet. Please contact support.",
  permission: "This service is not fully set up yet. Please contact support.",
  config: "This service is not fully configured yet. Please contact support.",
  network: "We could not reach the database. Please try again in a moment.",
  other: "This action is temporarily unavailable. Please try again shortly."
};
