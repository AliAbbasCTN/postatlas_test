# Next.js security upgrade: 16.4.0 to 16.4.3

## Why
Vercel's Security Insight reported that Next.js 16.4.0 is affected by a known vulnerability. Three advisories, published on 14 October 2026, apply to 16.4.0 and are fixed in **16.4.1**:

| Advisory | Severity | Problem | Does it touch this app? |
|---|---|---|---|
| GHSA-2464-fhr4-w9xw (CVE-2026-96889) | Critical | Remote code execution in the Image Optimization API with SVG files (through `sharp`) | No `next/image` and no `images` config are used, and `sharp` in the lockfile is already 0.35.5 (patched). Upgrade anyway. |
| GHSA-673q-mjm6-r5xr | Critical | Remote code execution in `"use cache"` functions that return typed arrays | No `"use cache"` anywhere in `src/`. Upgrade anyway. |
| GHSA-p3m5-59mp-jv5r (CVE-2026-94482) | High | Denial of service in the App Router with Server Actions | **Yes: the app has 33 `"use server"` action files.** This one matters here. |

The target is **16.4.3**, the current patch release of the 16.4 line (16.4.2 and 16.4.3 only add backported fixes on top of 16.4.1). The pin stays exact, as before. No application code needed to change.

## What changed in this repository
* `package.json`: `next` `16.4.0` to `16.4.3`.
* `package-lock.json`: only the root `next` entry was changed to match. **The resolved package entries (next, @next/env, the @next/swc-* binaries) can only be refreshed by npm talking to the registry, which was not possible when this archive was prepared, so they still read 16.4.0 until you run the step below.** Nothing was hand-edited or forged in the lockfile.
* `tests/dependency-security.test.ts` (new): fails if `next` is not pinned exactly, drops below the 16.4.1 floor, if the lockfile root disagrees with `package.json`, if `sharp` is older than 0.35.5, or if the installed `node_modules/next` is below the floor.

## What you must do (once)
```bash
npm install            # refreshes package-lock.json to next 16.4.3 and its SWC binaries; nothing else should change
npm run typecheck
npm test
npm run build
npm audit              # confirm no advisory is reported for next
git add package.json package-lock.json && git commit -m "Upgrade Next.js to 16.4.3 (security)" && git push
```
Then redeploy on Vercel; the Security Insight clears once the deployed build uses 16.4.3. Do **not** run `npm audit fix --force`: it can downgrade Next.js to an ancient version.

Alternative: `npx next upgrade --agent=security` (Vercel's own tool) makes the same change. Either way, commit the regenerated `package-lock.json`: `npm ci` (used by some CI systems) refuses a lockfile that disagrees with `package.json`.

## Not verified here
`npm install`, `next build` and the Next.js dev server were not run (no network in the preparation environment). The new tests and the rest of the suite were run; see the delivery notes.

## Staying patched
Watch https://github.com/vercel/next.js/security/advisories and Vercel's Security Insight. When a newer advisory appears, raise `FLOOR` in `tests/dependency-security.test.ts` together with the version bump.
