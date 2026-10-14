import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickActiveWorkspace, canHavePersonalWorkspace, workspaceLabel, type Workspace } from "../src/lib/workspace.ts";
import { orgCan } from "../src/lib/permissions.ts";

const personal: Workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Personal workspace", role: "owner", kind: "personal" };
const teamA: Workspace = { id: "22222222-2222-4222-8222-222222222222", name: "Acme", role: "seo_manager", kind: "team" };
const teamB: Workspace = { id: "33333333-3333-4333-8333-333333333333", name: "Globex", role: "viewer", kind: "team" };

test("an individual customer with only a personal workspace uses it", () => {
  assert.equal(pickActiveWorkspace([personal])?.id, personal.id);
});
test("no workspaces yet -> null (the server provisions the personal one on demand)", () => {
  assert.equal(pickActiveWorkspace([]), null);
});
test("without a stored preference a team wins over the personal workspace", () => {
  assert.equal(pickActiveWorkspace([personal, teamA])?.id, teamA.id);
  assert.equal(pickActiveWorkspace([teamA, teamB, personal])?.id, teamA.id);
});
test("a valid preference is honoured", () => {
  assert.equal(pickActiveWorkspace([personal, teamA, teamB], personal.id)?.id, personal.id);
  assert.equal(pickActiveWorkspace([personal, teamA, teamB], teamB.id)?.id, teamB.id);
});
test("a forged or stale preference can never select a workspace the caller is not a member of", () => {
  const stranger = "99999999-9999-4999-8999-999999999999";
  assert.equal(pickActiveWorkspace([personal], stranger)?.id, personal.id);
  assert.equal(pickActiveWorkspace([], stranger), null);
  assert.equal(pickActiveWorkspace([personal, teamA], "not-a-uuid")?.id, teamA.id);
});
test("only customer and publisher accounts get a personal workspace, never staff", () => {
  assert.equal(canHavePersonalWorkspace("user"), true);
  assert.equal(canHavePersonalWorkspace("publisher"), true);
  assert.equal(canHavePersonalWorkspace("admin"), false);
  assert.equal(canHavePersonalWorkspace("super_admin"), false);
  assert.equal(canHavePersonalWorkspace("owner"), false);
});
test("an individual (personal owner) can do everything a customer needs, and a team viewer still cannot", () => {
  for (const cap of ["manageWebsites", "manageOrders", "submitContent", "askAdvice"] as const) assert.equal(orgCan(personal.role, cap), true, cap);
  assert.equal(orgCan(teamB.role, "manageOrders"), false);
  assert.equal(orgCan(teamA.role, "manageTeam"), false);
});
test("labels", () => {
  assert.equal(workspaceLabel(personal), "Personal account");
  assert.equal(workspaceLabel(teamA), "Acme");
});

// ---- database migration (static checks: no Postgres is available in CI for this repo) -----------------------
const upgrade = readFileSync(new URL("../supabase/PostAtlas_upgrade_individual_customers.sql", import.meta.url), "utf8");
const fresh = readFileSync(new URL("../supabase/PostAtlas_fresh_supabase_schema.sql", import.meta.url), "utf8");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");

test("upgrade migration is additive: no drop table / truncate / delete / data rewrite outside the commented rollback", () => {
  const code = strip(upgrade);
  assert.ok(!/drop\s+table|truncate|delete\s+from|update\s+public\./i.test(code));
  assert.match(code, /add column if not exists kind text not null default 'team'/);
});
test("upgrade migration is re-runnable (idempotent constructs only)", () => {
  const code = strip(upgrade);
  assert.ok(!/create (unique )?index (?!if not exists)/i.test(code), "index without IF NOT EXISTS");
  assert.ok(!/create trigger (?!.*)/i.test(code));
  for (const m of code.matchAll(/create trigger (\w+)/g)) assert.match(code, new RegExp(`drop trigger if exists ${m[1]}`), `${m[1]} is not dropped first`);
  assert.ok(!/create function/i.test(code), "use CREATE OR REPLACE FUNCTION");
});
test("personal workspaces: one per user, owner-only membership, no invitations, server-only provisioning", () => {
  for (const src of [strip(upgrade), strip(fresh)]) {
    assert.match(src, /organizations_one_personal_per_user[\s\S]*where kind = 'personal'/);
    assert.match(src, /personal workspace can only have its owner as a member/);
    assert.match(src, /personal workspaces cannot have invitations/);
    assert.match(src, /workspace kind and owner cannot be changed/);
    assert.match(src, /function public\.ensure_personal_workspace\(p_user uuid\)[\s\S]*security definer set search_path = ''/);
  }
  assert.match(strip(upgrade), /revoke all on function public\.ensure_personal_workspace\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.ensure_personal_workspace\(uuid\) to service_role/);
  assert.match(strip(fresh), /grant execute on function public\.ensure_personal_workspace\(uuid\) to service_role/);
});
test("signup trigger still always assigns the 'user' role (no privilege path through the new code)", () => {
  assert.match(strip(fresh), /values \(new\.id[\s\S]*'user'\)/);
  assert.ok(!/platform_role\s*=\s*'(publisher|admin|super_admin)'/.test(strip(upgrade)));
});
test("provisioning is only reachable from server code: nothing client-side calls the RPC", () => {
  const auth = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /import "server-only"/);
  assert.match(auth, /rpc\("ensure_personal_workspace", \{ p_user: s\.user\.id \}\)/, "must use the id from the verified session");
});
