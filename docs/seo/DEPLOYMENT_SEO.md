# Deployment and go-live checklist (SEO)

## 1. Environment variables (Vercel > Project > Settings > Environment Variables)
| Variable | Production | Test / preview | Notes |
|---|---|---|---|
| `SITE_URL` | `https://your-real-domain` (no trailing slash) | the test URL, or unset for previews | Required in production. Every canonical, sitemap URL, structured-data URL and email link comes from it. |
| `ALLOW_INDEXING` | leave unset | leave unset | Unset means: indexable only on a real domain. Set `true` only to index a `*.vercel.app` host on purpose; `false` forces indexing off anywhere. |

How the app behaves (tested in `tests/seo.test.ts`):
* Production with a real domain: indexable, sitemap published.
* `localhost`, `*.vercel.app` (including `postatlas-test.vercel.app`) and previews: `noindex` on every page, `Disallow: /` in robots.txt, empty sitemap. **The test subdomain therefore stays out of Google by default.** It is not assumed to be the production domain.
* Production with `SITE_URL` missing: the build/server fails loudly instead of publishing localhost URLs.

## 2. Going live on the real domain
1. Choose and register the domain (check availability and trademarks first: see BRAND_ANALYSIS.md).
2. Add the domain in Vercel, set the apex as primary and redirect `www` to it (or the reverse) at Vercel. Force HTTPS.
3. Set `SITE_URL` in the **Production** environment to that origin and redeploy.
4. Open `https://your-domain/robots.txt` (should list the sitemap and disallow only the private paths) and `https://your-domain/sitemap.xml` (should list the public pages including the four landing pages).
5. View source on `/`, `/buy-guest-posts`, `/publishers`: check the `<title>`, canonical, Open Graph tags and JSON-LD show the real domain.

## 3. Search engines
1. Add the domain as a property in **Google Search Console** (DNS verification) and submit `https://your-domain/sitemap.xml`. Add **Bing Webmaster Tools** (you can import from Search Console).
2. Inspect the homepage and one landing page with URL Inspection; request indexing.
3. After 2-4 weeks, read Search Console > Performance by page and by query, and replace the ESTIMATE columns in KEYWORD_RESEARCH.md with real impressions.

## 4. Post-deploy checks
* Rich Results Test on `/buy-guest-posts` (Service, BreadcrumbList, FAQPage) and `/` (Organization, WebSite).
* PageSpeed Insights (mobile) for `/`, `/publishers`, `/buy-guest-posts`. Fix what it reports; none of the numbers are claimed in this repository.
* Crawl the live site once (Screaming Frog free tier covers 500 URLs) to find broken links and duplicate titles.
* Keep the sign-in, dashboard, admin and publisher areas out of the sitemap and `noindex` (already enforced and tested).

## 5. Content to add over time (only with real substance)
Short, accurate guides in `/blog` that answer a question your own product can answer; comparison pages only after the catalogue has real inventory and facts can be verified; verified-buyer reviews will appear on listings automatically as orders complete.
