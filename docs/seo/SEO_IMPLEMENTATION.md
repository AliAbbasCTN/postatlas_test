# What was changed in the code (SEO pass)

Principle: keep every application behaviour as it was (auth, authorization, dashboards, orders, hour-based timers, replacement flow, verification, monitoring, payments, payouts, database). All changes are in public-page metadata, content, configuration and tests. No new dependency, no database change.

## Found on the test deployment and fixed
| Finding (live page fetched) | Fix |
|---|---|
| The homepage title rendered as "PostAtlas - ... \| PostAtlas" (brand twice, because the layout template adds the brand) | `pageMeta()` emits an **absolute** title when the supplied title already contains the brand. A test checks every public page. |
| The homepage H1 "Find the Right Websites. Build Better Backlinks." did not say what PostAtlas is | New H1 and intro: "Guest post and backlink marketplace where every link is verified". |
| No Open Graph image; Twitter card was the small "summary" type | `public/og-image.png` (1200x630) and `summary_large_image` on every page. |
| The test deployment on `*.vercel.app` was indexable, so it could compete with the real domain | `src/lib/site-env.ts`: **indexing is allowed only on a real production domain**. `localhost` and `*.vercel.app` get `noindex` metadata, `Disallow: /` in robots.txt and an empty sitemap, unless `ALLOW_INDEXING=true`. |
| `SITE_URL` fell back to production-only throwing; previews could emit wrong canonicals | SITE_URL always wins; Vercel preview falls back to its own URL; production without SITE_URL still fails loudly. |
| Fonts loaded through a CSS `@import` (delays discovery) | `preconnect` + stylesheet `<link>` in `<head>`, `display=swap`. |
| `robots.txt` disallowed pages that carry `noindex` (a crawler cannot see noindex on a blocked page) and used the unsupported `host` directive | Removed those entries and `host`. Private areas (`/admin`, `/dashboard`, `/publisher`, `/api/`, `/auth/`) stay blocked and are also `noindex, no-store`. |
| `/for-publishers` description was 172 characters (truncated in results) | Shortened to fit. A test now enforces 60-170. |
| `/check` title described the form, not the tool | "Free website SEO check: titles, headings, mobile, indexability". |

## Added
* **Four landing pages** with distinct intent (see KEYWORD_PAGE_MAP.md): `/buy-guest-posts`, `/link-insertion-service`, `/backlink-monitoring`, `/guest-post-vs-link-insertion`. Content in `src/lib/landing-pages.ts`, layout in `src/components/SeoLanding.tsx`. Each has one H1, H2/H3 hierarchy, visible FAQs, related links, breadcrumbs, canonical and Open Graph data.
* **Structured data** (`src/lib/seo-schema.ts`): Organization and WebSite once for every public page (marketing layout); BreadcrumbList, Service (or Article for the guide) and FAQPage on landing pages. Nothing invented: no ratings, reviews, address, phone, price or social profile. The site-level Organization and WebSite previously on the homepage moved to the layout so they are not duplicated.
* **Internal links:** homepage "What you can order" section, footer links, links from `/how-it-works` and `/pricing`, and a related-pages block on every landing page.
* **Sitemap:** includes the landing pages; empty where indexing is disabled.
* `.env.example`: documents `ALLOW_INDEXING`. `npm run seo:check` runs the SEO test file.

## Not changed (and why)
* `next.config.mjs` security headers and the private-area `X-Robots-Tag` header: already correct.
* Existing Breadcrumb/Article/Service JSON-LD on blog and listing pages: already present.
* There are no `<img>` elements in the app (the brand mark is inline SVG), so there were no alt texts or image-delivery issues to fix; the only raster asset added is the OG image.
* No claims about rankings, volumes or guarantees were added anywhere.
