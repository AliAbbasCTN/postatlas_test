import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Static regression guard: every exported server action must establish who is calling before touching data.
// Public-by-design actions are listed explicitly; anything new must either authenticate or be added here on purpose.
const dir = new URL("../src/lib/actions/", import.meta.url);
const GUARD = /\b(actionSession|actionWorkspace|actionAdmin|actionSuperAdmin|actionPublisher|getSession|requireSession|publisherOrder)\s*\(/;
const PUBLIC_BY_DESIGN: Record<string, string[]> = {
  "auth.ts": ["signUp", "signIn", "signOut", "requestPasswordReset"],
  "contact.ts": ["submitContact"],
  "write-for-us.ts": ["submitWriteForUs"],
  "public-check.ts": ["startSiteCheck"]
};

function exportedActions(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /export async function (\w+)\s*\(/g;
  const starts: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
  starts.forEach((s, i) => out.push({ name: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
  return out;
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(new URL(file, dir), "utf8");
  if (!src.includes('"use server"')) continue;
  for (const a of exportedActions(src)) {
    test(`${file}:${a.name} authenticates the caller (or is public by design)`, () => {
      const allowedPublic = PUBLIC_BY_DESIGN[file]?.includes(a.name);
      assert.ok(allowedPublic || GUARD.test(a.body), `${a.name} has no authentication guard`);
    });
  }
}

test("no server action file exports a non-async helper (everything exported from 'use server' is a public endpoint)", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(new URL(file, dir), "utf8");
    if (!src.includes('"use server"')) continue;
    const bad = [...src.matchAll(/^export (?!async function)(const|function|let|class)\s+(\w+)/gm)];
    assert.deepEqual(bad.map((m) => m[2]), [], `${file} exports non-action values`);
  }
});

test("service-role client is only imported by server-side modules", () => {
  const walk = (d: URL): URL[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(new URL(`${e.name}/`, d))
        : [new URL(e.name, d)]
    );

  for (const f of walk(new URL("../src/", import.meta.url)).filter((f) => /\.(ts|tsx)$/.test(f.pathname))) {
    const src = readFileSync(f, "utf8");

    if (/^\s*["']use client["']/.test(src)) {
      assert.ok(
        !/supabase\/admin|SERVICE_ROLE/.test(src),
        `${f.pathname} is a client module touching the service role`
      );
    }
  }
});

test("signUp never requires or creates an organisation, never reads a role, and rolls back a half-created account", () => {
  const src = readFileSync(new URL("../src/lib/actions/auth.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function signUp"), src.indexOf("export async function signIn"));
  assert.ok(!/formData\.get\("(org|organization|organisation|company)[a-z_]*"\)/i.test(body), "signup must not read an organisation field");
  assert.ok(!/from\("organizations"\)\.insert|from\("organization_members"\)\.insert/.test(body), "signup must not create an organisation");
  assert.ok(!/!orgName|orgName\b/.test(body), "no organisation-name validation may remain in signup");
  assert.ok(body.includes("rollbackNewAccount("), "a failed setup must roll back the new Auth user");
  assert.ok(!/platform_role|raw_user_meta_data|formData\.get\("role"\)/.test(body), "signup must never read a role");
});

test("no customer page or action still hard-requires an organisation membership", () => {
  const files: URL[] = [];
  const walk = (d: URL) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : files.push(new URL(e.name, d)); };
  walk(new URL("../src/", import.meta.url));
  for (const f of files.filter((x) => /\.(ts|tsx)$/.test(x.pathname))) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/\b(requireOrg|actionOrg)\b/.test(src), `${f.pathname} still uses the organisation-only guard`);
    assert.ok(!/redirect\(["']\/dashboard\/settings["']\)/.test(src), `${f.pathname} sends customers to settings to set up an organisation`);
  }
});

test("order-scoped actions authorise by membership in the workspace that owns the order", () => {
  for (const file of ["orders.ts", "payments.ts", "submissions.ts", "disputes.ts", "fulfillment.ts"]) {
    const src = readFileSync(new URL(file, dir), "utf8");
    assert.ok(!/kind:\s*"org"/.test(src), `${file} still scopes orders to a single active organisation id`);
  }
});
