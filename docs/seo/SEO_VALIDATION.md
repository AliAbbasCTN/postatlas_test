# Validation results (actual, October 24, 2026)

## Run and passed
| Check | Command / method | Result |
|---|---|---|
| Whole project test suite | `node --test "tests/*.test.ts"` | **365 tests: 363 pass, 2 fail.** The 2 failures are `tests/db-payouts.test.ts` and `tests/db-reviews-deadlines.test.ts`; both need the PGlite package, which could not be installed (no network). `db-payouts` fails identically on the untouched project. Run them after `npm install`. |
| New SEO suite | `npm run seo:check` (= `node --test tests/seo.test.ts`) | **17 / 17 pass**: environment rules (canonical origin, indexing matrix), robots.txt and sitemap rules, private areas noindex, title and description uniqueness and length for every public page, landing-page uniqueness and internal links, no invented claims, structured-data shape (no ratings/reviews/phone/address), OG image is a 1200x630 PNG, fonts in `<head>`, `.env.example` has no secrets. |
| Existing UI/brand/permission tests after the changes | same full suite | Pass. One assertion was updated on purpose: `ui-system.test.ts` pinned the old homepage H1; it now pins the new one. |
| TypeScript on the changed files | `tsc` with stub declarations for the packages that are not installed | **No errors in any new or changed file** other than stub artifacts (missing `@types/node` / `MetadataRoute` namespace in the stubs). One real error found in my own test was fixed. This is weaker than the project's real `npm run typecheck`, which was not possible here. |
| Landing page metadata | computed from `src/lib/landing-pages.ts` | Titles 58-70 characters including the brand, descriptions 148-155, one H1 each, 3-4 H2 sections, 3-5 visible FAQs, about 400-640 words each. |
| Live test deployment | fetched `https://postatlas-test.vercel.app/` | Found the duplicated brand in the homepage title and the generic H1 (both fixed). The deployment predates these changes, so the new pages are not live there yet. |

## NOT verified (could not be run here)
* **`next build` / production build**, and therefore real route rendering, generated `robots.txt` and `sitemap.xml` output, and `/og-image.png` serving. Run `npm install && npm run typecheck && npm test && npm run build` first; if anything fails, it will be in the files listed in SEO_IMPLEMENTATION.md.
* **Core Web Vitals, Lighthouse, PageSpeed, mobile usability**. No browser or network. No performance score is claimed. Static facts only: the app renders no raster `<img>` elements (inline SVG brand mark), loads no third-party scripts, and now loads fonts from `<head>` with preconnect; marketing pages are statically rendered by design. Measure with PageSpeed Insights on the deployed URL.
* **Google structured-data validation** (Rich Results Test / Schema Markup Validator). The JSON-LD was checked for shape and for the absence of invented fields only. FAQ rich results are no longer shown by Google for most sites, so do not expect them; the markup is valid and matches visible text.
* **Redirects and HTTP status codes** beyond the code: `/authority-audit` permanently redirects to `/check` (code), Next.js removes trailing slashes by default. Verify `www` to apex and `http` to `https` at the domain/Vercel level after you pick the production domain.
* **Broken-link crawl** of the live site. Internal links on the new pages are checked against existing routes in the test suite, not by a crawler.
* **Rankings, traffic, indexing speed**: nothing here can promise them.
