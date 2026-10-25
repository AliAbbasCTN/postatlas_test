import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Static checks on the one-file schema. They cannot replace running it in Postgres, but they catch the mistakes
// that matter most for security: a table without RLS, a write grant to a browser role, a missing server-only grant.
const sql = readFileSync(new URL("../supabase/PostAtlas_fresh_supabase_schema.sql", import.meta.url), "utf8");
const code = sql.replace(/--[^\n]*/g, "");
const tables = [...code.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);

test("schema defines the expected core tables", () => {
  for (const t of ["profiles", "organizations", "orders", "payments", "content_submissions", "published_placements", "backlink_checks", "advice_threads", "disputes", "audit_logs", "rate_limits"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
});

test("legacy tables and columns are gone", () => {
  for (const legacy of ["campaigns", "clients"]) assert.ok(!tables.includes(legacy), legacy);
  for (const col of ["campaign_id", "article_title", "article_content", "proof_file_path", "file_path"]) assert.ok(!code.includes(col), col);
});

test("RLS is enabled on every table", () => {
  const enabled = new Set([...code.matchAll(/alter table public\.(\w+)\s+enable row level security/g)].map((m) => m[1]));
  assert.deepEqual(tables.filter((t) => !enabled.has(t)), []);
});

test("only SELECT policies exist: the browser has no write path", () => {
  const policies = [...code.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+)/g)];
  assert.ok(policies.length > 20);
  assert.deepEqual(policies.filter((p) => p[3] !== "select").map((p) => p[1]), []);
});

test("no grant of insert/update/delete/truncate/all to anon or authenticated", () => {
  const grants = [...code.matchAll(/grant\s+([^;]*?)\s+on\s+[^;]*?\s+to\s+([^;]*);/gi)];
  for (const g of grants) {
    if (/\b(anon|authenticated)\b/i.test(g[2]) && !/execute/i.test(g[1]) && !/usage/i.test(g[1])) {
      assert.ok(/^\s*select\b/i.test(g[1]), `non-select grant to a browser role: ${g[0].slice(0, 90)}`);
    }
  }
});

test("private tables are never granted to browser roles", () => {
  const priv = ["publisher_supplier_info", "publisher_payouts", "payments", "payment_methods", "platform_settings", "audit_logs", "rate_limits", "messages", "organization_invitations", "publisher_profiles", "order_status_transitions", "site_checks"];
  const grantText = [...code.matchAll(/grant\s+select[^;]*;/gi)].map((m) => m[0]).join("\n");
  for (const t of priv) assert.ok(!new RegExp(`public\\.${t}\\b`).test(grantText), `${t} is granted to a browser role`);
});

test("server-only functions are granted to service_role and revoked from everyone else", () => {
  for (const fn of ["transition_order", "claim_due_placements", "rate_limit_hit", "ensure_personal_workspace"]) {
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
    assert.ok(!new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)[^;]*\\b(anon|authenticated)\\b`).test(code), `${fn} granted to a browser role`);
  }
  assert.match(code, /revoke all on all functions in schema public from public, anon, authenticated/);
});

test("every SECURITY DEFINER function pins an empty search_path", () => {
  const fns = code.split(/create function /).slice(1);
  for (const f of fns) {
    const head = f.split(/\$\$/)[0];
    if (/security definer/i.test(head)) assert.match(head, /set search_path = ''/, head.slice(0, 60));
  }
});

test("profiles can only be created by the auth trigger, with role 'user'", () => {
  assert.match(code, /create trigger on_auth_user_created after insert on auth\.users/);
  assert.match(code, /values \(new\.id, [^;]*'user'\)/);
  assert.ok(!/raw_user_meta_data\s*->>\s*'(platform_)?role'/.test(code), "role must never come from user metadata");
  assert.ok(!/insert into public\.profiles[^;]*'(admin|super_admin)'/.test(code));
});

test("no super admin is created by the schema (promotion example stays commented out)", () => {
  assert.ok(!/update public\.profiles\s+set\s+platform_role/i.test(code));
  assert.match(sql, /-- UPDATE public\.profiles/);
});

test("order lifecycle protection is present", () => {
  assert.match(code, /order status can only change through transition_order\(\)/);
  assert.match(code, /payment amount must equal the order price/);
  assert.match(code, /create trigger audit_logs_append_only/);
  assert.match(code, /disputes_one_open_per_order/);
});

test("repository has no leftover incremental migrations", () => {
  const dir = new URL("../supabase/", import.meta.url);
  assert.ok(!readdirSync(dir).includes("migrations"));
});

test("the public report page is never indexed and the check action is public only by design", () => {
  const page = readFileSync(new URL("../src/app/(marketing)/check/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  const action = readFileSync(new URL("../src/lib/actions/public-check.ts", import.meta.url), "utf8");
  assert.match(action, /rateLimit\(/);
  assert.match(action, /normalizeDomain\(/);
  assert.ok(!/service_role|SERVICE_ROLE/.test(action));
});
