# SEO metrics: what is real, where it comes from, what it costs

| Report section / metric | Source | Needs credentials? | Label in the UI |
|---|---|---|---|
| HTTP status, redirects, HTTPS, canonical, indexability (meta robots, X-Robots-Tag, robots.txt), titles, meta descriptions, headings, sitemap/robots presence, internal links, broken-link sample, page-level findings | PostAtlas's own SSRF-safe crawl of public pages | **No** | Observed |
| Technical score (0-100) | PostAtlas formula over those findings (see the formula shown in the report) | No | Calculated (never called DR/DA) |
| Domain Rating, referring domains, backlinks (live / all time), DR and referring-domain history | Ahrefs API v3 (`domain-rating`, `backlinks-stats`, `*-history`) | **Yes** - paid Ahrefs plan with API v3 access | Provider index data, with provider + fetch date |
| Estimated organic traffic, keywords, traffic trend, traffic by country, top pages, top keywords | Ahrefs API v3 (`metrics`, `metrics-history`, `metrics-by-country`, `top-pages`, `organic-keywords`) | **Yes** | Estimate |
| Backlink gap vs closest organic competitor | Calculated from two Ahrefs `refdomains` lists (competitor top 100 by DR vs your first 1,000) | **Yes** | Calculated (sample) |
| Domain Authority (Moz) | Not implemented: needs a Moz Links API provider | - | Shown as not available |
| Dofollow / nofollow totals | Not provided by the summary endpoints used; not shown | - | Not shown |

## Verified vs not verified
* Verified against Ahrefs' published documentation: that API v3 exists, is keyed with a bearer token, is unit-metered, and has the endpoint names above (`docs.ahrefs.com/reference`). Ahrefs' help pages disagree on which plans include API access (an older page says Enterprise only; a newer one says all paid plans from Lite, with extra units only on Enterprise). **Check your plan with Ahrefs before relying on it.**
* **Not verified:** the exact JSON response shapes. The adapter (`src/lib/seo/ahrefs.ts`) parses defensively (missing field -> unavailable, never 0) and is tested only against fixtures written from the reference. Before launch run one live check with your key and compare the report with the Ahrefs UI.
* Moz, Semrush, DataForSEO and others were not evaluated or integrated.

## Operating it
* Set `SEO_PROVIDER=ahrefs` and `AHREFS_API_KEY` on the server only. Unset = honest "not connected" state.
* Cost controls: results for the same domain are reused for `SEO_CACHE_HOURS` (default 72), a global `SEO_PROVIDER_DAILY_BUDGET` (default 150 lookups/day) applies, and the existing per-IP (8/h) and global (400/h) public-check limits stay. One uncached lookup uses roughly 12 provider requests; check your unit price.
* Each call has a 12-second timeout; a failure only blanks its own section (reasons: no provider, key/plan, rate limited, timeout, provider error, no data, budget).
* Adding a provider: implement `SeoOverviewProvider` (`src/lib/seo/types.ts`) and register it in `src/lib/seo/provider.ts`. The report UI does not change.
* Licensing: show provider attribution (the report does) and follow your provider's terms on redisplaying data to the public.


## Free Domain Rating (no paid Ahrefs plan)
Set `SEO_PROVIDER=ahrefs-free` and `AHREFS_API_KEY=<free APIv3 key>` (Ahrefs account > Account settings > API keys). The app then calls Ahrefs' **free** endpoint `GET https://api.ahrefs.com/v3/public/domain-rating-free?target=<domain>&version=dr3&output=json` (Bearer key). It costs no API units and works for any domain, and the report shows Domain Rating as a ring at the top.

Why the earlier setup showed nothing: `SEO_PROVIDER=ahrefs` calls the **paid** Site Explorer endpoints. A free key may call those only for `ahrefs.com`, `yep.com` and `firehose.com`; for any other domain Ahrefs answers 403 and the report says "not available". With `SEO_PROVIDER=ahrefs` the app now also falls back to the free endpoint when DR is refused, but `ahrefs-free` is the cleaner choice for a free key (it skips the paid calls).

What the free endpoint does NOT give: referring domains, backlink counts, history charts, organic traffic, keywords, backlink gap. Those sections say they need a paid plan. Licence: Ahrefs requires the attribution "Domain Rating by Ahrefs" linking to https://ahrefs.com/ wherever DR is shown (the badge includes it). Ahrefs' public limit is about 60 requests per minute; results are reused for `SEO_CACHE_HOURS` (default 72).

After changing the environment variables, **redeploy / restart**, then run a NEW website check: reports are stored when they are created, so an old report keeps showing the old "not available" result.
