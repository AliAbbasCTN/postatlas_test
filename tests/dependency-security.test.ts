import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Security floor for Next.js. 16.4.0 is affected by three advisories published on 14 October 2026, all fixed in 16.4.1:
//   GHSA-2464-fhr4-w9xw (critical, remote code execution in the Image Optimization API with SVG files)
//   GHSA-673q-mjm6-r5xr (critical, remote code execution in "use cache" functions that return typed arrays)
//   GHSA-p3m5-59mp-jv5r (high, denial of service in the App Router with Server Actions, which this app uses)
// Raise FLOOR only after reading a newer advisory; never lower it.
const FLOOR = [16, 4, 1] as const;
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const parse = (v: string): number[] => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()); assert.ok(m, `"${v}" must be an exact version (no ^ or ~), so the audited version is what gets installed`); return [Number(m![1]), Number(m![2]), Number(m![3])]; };
const atLeast = (v: number[], f: readonly number[]) => { for (let i = 0; i < 3; i++) { if (v[i] !== f[i]) return v[i] > f[i]; } return true; };

test("package.json pins an exact Next.js version at or above the security floor", () => {
  const pkg = JSON.parse(read("package.json"));
  const v = parse(pkg.dependencies.next);
  assert.ok(atLeast(v, FLOOR), `next ${pkg.dependencies.next} is below the security floor ${FLOOR.join(".")}`);
  assert.equal(v[0], 16, "stay on the 16.x line unless a migration is planned");
});

test("package-lock.json root agrees with package.json (otherwise `npm ci` fails and an old Next.js can slip back in)", () => {
  const pkg = JSON.parse(read("package.json")), lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages[""].dependencies.next, pkg.dependencies.next);
});

test("sharp, which the image optimiser uses, is at the patched 0.35.5 or newer", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const s = lock.packages["node_modules/sharp"]?.version;
  if (s) assert.ok(atLeast(parse(s), [0, 35, 5]), `sharp ${s} is below 0.35.5`);
});

test("the Next.js that is actually installed is at or above the floor (run `npm install` after changing package.json)", { skip: !existsSync(new URL("../node_modules/next/package.json", import.meta.url)) }, () => {
  const installed = JSON.parse(read("node_modules/next/package.json")).version as string;
  assert.ok(atLeast(parse(installed), FLOOR), `node_modules has next ${installed}: run "npm install" to apply the upgrade`);
});

test("the app does not opt in to the riskiest code paths named in the advisories", () => {
  const cfg = read("next.config.mjs");
  assert.ok(!/dangerouslyAllowSVG/.test(cfg), "SVG through the image optimiser is the RCE path");
});
