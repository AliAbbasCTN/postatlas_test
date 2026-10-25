import test from "node:test";
import assert from "node:assert/strict";
import { orgCan, grantableRoles, canChangeRoleOf, isAdminRole } from "../src/lib/permissions.ts";

test("viewers cannot order, pay, submit articles or manage the team", () => {
  for (const cap of ["manageOrders", "submitContent", "manageTeam", "manageWebsites"] as const) assert.equal(orgCan("viewer", cap), false, cap);
  assert.equal(orgCan(null, "askAdvice"), false);
});
test("only owners manage the team", () => {
  assert.equal(orgCan("owner", "manageTeam"), true);
  for (const r of ["seo_manager", "seo_specialist", "content_manager", "viewer"] as const) assert.equal(orgCan(r, "manageTeam"), false);
});
test("nobody can grant super_admin from the app, and admins cannot create admins", () => {
  assert.ok(!grantableRoles("super_admin").includes("super_admin" as never));
  assert.ok(!grantableRoles("admin").includes("admin"));
  assert.deepEqual(grantableRoles("user"), []);
  assert.deepEqual(grantableRoles("publisher"), []);
  assert.equal(canChangeRoleOf("super_admin", "user", "super_admin"), false);
});
test("super admins are immutable and peers cannot demote each other", () => {
  assert.equal(canChangeRoleOf("super_admin", "super_admin", "user"), false);
  assert.equal(canChangeRoleOf("admin", "super_admin", "user"), false);
  assert.equal(canChangeRoleOf("admin", "admin", "user"), false);
  assert.equal(canChangeRoleOf("super_admin", "admin", "user"), true);
  assert.equal(canChangeRoleOf("admin", "user", "publisher"), true);
  assert.equal(canChangeRoleOf("admin", "user", "admin"), false);
});
test("org roles never imply platform admin", () => {
  assert.equal(isAdminRole("owner"), false);
  assert.equal(isAdminRole("user"), false);
  assert.equal(isAdminRole("publisher"), false);
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("super_admin"), true);
});
