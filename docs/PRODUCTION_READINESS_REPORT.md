# PostAtlas readiness pass: what was verified, fixed, and not done

Date: 2026-10-14. Every number below came from a command run in this pass.

## Baseline (before changes)
| Check | Result |
|---|---|
| `npm audit` | 8 vulnerabilities (2 moderate, 6 high). Tailwind 3 dependency tree (7) plus `next` itself (direct, 6 advisories). |
| `tsc --noEmit` | **39 errors**: 30 BigInt literals vs `target ES2018`, crypto Buffer typings (old `@types/node`), 1 test typing |
| `npm run build` | **Failed** at type-check |
| `npm test` | 265/265 pass, with `MODULE_TYPELESS_PACKAGE_JSON` warning |

## After
| Check | Result |
|---|---|
| `npm ci` | OK |
| `npm audit` | **5 high** (see below) |
| `tsc --noEmit` | 0 errors |
| `npm test` | **288/288 pass**, 0 warnings. Includes 13 executable DB tests |
| `npm run build` | OK (exit 0) |
| Live smoke (`next start`) | public routes 200; `/dashboard`, `/admin`, `/admin/payouts`, `/publisher/payouts` redirect to `/login`; cron 401 without/with wrong token; CSP/HSTS/XFO/nosniff present |

## Vulnerabilities
Historical "8" = 7 Tailwind-tree findings + `next`. "7" (later audit) = the Tailwind tree after `next` was fixed.
* `next` 16.3.6 to **16.4.0**: fixed.
* `postcss-selector-parser`, `postcss-nested` (2 moderate): fixed by Tailwind 3.4.19 and an override to `postcss-selector-parser@^7.1.6`; build and generated CSS verified.
* **Remaining (5 high, unfixable within Tailwind 3):** `braces`, `micromatch`, `fast-glob`, `chokidar`, `tailwindcss`. `braces` has **no patched release** (3.0.3 is the newest on npm). All are dev-time dependencies used by Tailwind's content scanner on this repository's own files, not in the production runtime. Remaining mitigation: migrate to Tailwind 4. Not done blind because it renames ~100 utilities (`rounded`, `shadow`, `ring`, border-color default) and cannot be visually verified without a browser.

## Payout feature: the brief's premise was partly wrong
Payout Settings **already existed** (`/publisher/payouts`, in nav, AES-256-GCM, server-side ownership, admin verification gate). Likely reasons it looked missing: `.env.example` ships an invalid `PAYOUT_DATA_KEY` placeholder, which hides the form behind "temporarily unavailable"; or the finance migration was not applied. Changes: readiness status, last-updated/verified dates, supported-method statement, IBAN check-digit validation, atomic replace, owner notification on change, admin setup banner, admin list of publishers lacking verified details, publisher names and references in history, auditable **reject payout** with reason, hold reason now audited, full-account reveal limited to payouts actually being processed.
Supported method: **manual bank transfer only** (USD or PKR account). No automatic rail exists; none was invented.

## Financial defects found by executing the SQL (not visible to the old regex tests)
1. Reassignment accepted a replacement priced above the customer's budget ($150 on a $100 order).
2. Replacement pay used the *live* listing price: a publisher raising their price after assignment produced a $392 payout on a $100 order.
3. After a link-loss reassignment, the original's unpaid entitlement stayed payable (docs said cancelled): both paid, $490 total.
4. `create_payout_obligation` was not idempotent (raised on repeat), and an existing test asserted the dead branch that was meant to prevent it.
5. Saving new payout details was two non-atomic statements.
Fix: `supabase/PostAtlas_upgrade_payout_hardening.sql` (idempotent) plus the same definitions in the fresh schema and finance upgrade. 7 of 13 DB tests fail on the original schema and all 13 pass after; the hardening file applied twice on the original schema also yields 13/13.

Interpretation to confirm: "within the original budget" = replacement list price <= customer list price. Pay stays 98% of the replacement's own price (the documented rule).

## Other fixes
tsconfig target, `@types/node`, `"type": "module"`; `getSession` no longer swallows Next control-flow signals; FX duplicate-refresh guard (10 min, DB-backed, `fx_rates` still append-only); marketplace: link-insertion-only publishers no longer vanish under a price cap, domain search, counts, reset links, turnaround shown, 8s public-DB timeout, parallel FX lookup.

## NOT done / NOT verified (release blockers marked)
* **Not run against real Supabase.** PGlite exercised the schema and hardening file; PostgREST embeds added to the admin payouts page (`publisher_profiles(display_name)`) are untested. The two older upgrade files were never run against a pre-upgrade database.
* No concurrency test (PGlite is single-connection); duplicate protection relies on tested unique indexes and `FOR UPDATE`/`skip locked`, not a parallel load test.
* No browser, keyboard, contrast, or mobile verification was possible. No lint script exists in the project.
* **UI redesign is partial.** Only the marketplace, publisher payout page, and admin payouts/overview were changed. Homepage, pricing, audit (`/check`), customer dashboard, and publisher/admin navigation were not redesigned.
* CSP still allows `'unsafe-inline'` scripts (nonce migration not done; documented in README).
* 5 high dev-time audit findings remain (above).
* Not tested with real email/payment providers. Write for Us was read and reasoned about, plus `sendEmail` semantics, but has no mocked-provider tests.
* Rate limiting and RLS policies were reviewed only superficially; no authorization penetration testing was performed.
* **Release-blocking until done:** apply the hardening SQL, set a valid `PAYOUT_DATA_KEY`/`CRON_SECRET`/email vars, and run the verify script on staging.
