import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyAuthError, classifyDbError, AUTH_MESSAGES, DB_MESSAGES } from "../src/lib/auth-errors.ts";

test("Supabase rate limits are reported as rate limits, not as a generic outage", () => {
  assert.equal(classifyAuthError({ status: 429, code: "over_request_rate_limit", message: "x" }), "rate_limited");
  assert.equal(classifyAuthError({ status: 429, message: "Too many requests" }), "rate_limited");
  assert.equal(classifyAuthError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }), "email_rate_limited");
});

test("credential, confirmation, password and duplicate errors map to their own messages", () => {
  assert.equal(classifyAuthError({ status: 400, code: "invalid_credentials" }), "invalid_credentials");
  assert.equal(classifyAuthError({ status: 400, code: "email_not_confirmed" }), "email_not_confirmed");
  assert.equal(classifyAuthError({ code: "weak_password", message: "Password should be at least 6 characters" }), "weak_password");
  assert.equal(classifyAuthError({ code: "user_already_exists" }), "already_registered");
});

test("server and network failures are not mistaken for bad credentials", () => {
  assert.equal(classifyAuthError({ status: 500, message: "boom" }), "network");
  assert.equal(classifyAuthError({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }), "network");
  assert.equal(classifyAuthError({ message: "something odd" }), "service");
});

test("missing database objects, permissions and config are told apart", () => {
  assert.equal(classifyDbError({ code: "PGRST202", message: "Could not find the function public.rate_limit_hit" }), "missing_object");
  assert.equal(classifyDbError({ code: "42P01" }), "missing_object");
  assert.equal(classifyDbError({ code: "42501", message: "permission denied for function" }), "permission");
  assert.equal(classifyDbError({ message: "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured." }), "config");
  assert.equal(classifyDbError({ message: "fetch failed" }), "network");
  assert.equal(classifyDbError({ message: "weird" }), "other");
});

test("user-facing messages never contain secrets or internals", () => {
  for (const m of [...Object.values(AUTH_MESSAGES), ...Object.values(DB_MESSAGES)]) {
    assert.ok(!/service_role|SUPABASE_|PGRST|rpc|jwt/i.test(m), m);
  }
});

test("sign-in and sign-up use the classifier and the limiter logs a category, never the key", () => {
  const auth = readFileSync(new URL("../src/lib/actions/auth.ts", import.meta.url), "utf8");
  const rl = readFileSync(new URL("../src/lib/rate-limit.ts", import.meta.url), "utf8");
  assert.match(auth, /classifyAuthError\(error\)/);
  assert.ok(!/error\.status === 400 \|\|/.test(auth), "blanket 400/401 => invalid credentials mapping must stay removed");
  assert.match(rl, /classifyDbError/);
  assert.ok(!/console\.error\([^)]*\bkey\b/.test(rl), "rate limiter must not log the key (contains IPs/emails)");
  assert.match(rl, /failOpen/, "limiter must still fail closed by default");
  assert.ok(!/formData\.get\("(role|platform_role|org_id|organization_id)"\)/.test(auth), "signup/login must never read a role or workspace from the form");
});
