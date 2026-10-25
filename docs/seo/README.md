# PostAtlas SEO research and implementation (October 24, 2026)

| File | What it contains |
|---|---|
| [BRAND_ANALYSIS.md](BRAND_ANALYSIS.md) | Is "PostAtlas" a good name? 12 alternatives compared. Final recommendation. |
| [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md) | Collaborator, Adsy, WhitePress, Links.me, PRPosting and others: what was verified and what was not. |
| [KEYWORD_RESEARCH.md](KEYWORD_RESEARCH.md) | Keyword universe by intent and cluster, with the data limits stated plainly. |
| [KEYWORD_PAGE_MAP.md](KEYWORD_PAGE_MAP.md) | Which page owns which keyword cluster, and the anti-cannibalisation rules. |
| [SEO_IMPLEMENTATION.md](SEO_IMPLEMENTATION.md) | Every change made in the code, and why. |
| [SEO_VALIDATION.md](SEO_VALIDATION.md) | What was actually run and what each result was; what could not be verified. |
| [DEPLOYMENT_SEO.md](DEPLOYMENT_SEO.md) | Step-by-step go-live instructions for the production domain. |

## Data-quality legend (used in every file)
* **VERIFIED**: read directly during this work (a page fetched live, or code run here).
* **THIRD-PARTY**: stated by a review or roundup article, not by the company itself. Treat as a claim.
* **ESTIMATE**: reasoning from SERP structure or experience, not tool data.
* **NOT AVAILABLE**: needs a paid keyword tool, Google Search Console or a trademark/domain registry that was not reachable. **No search-volume, keyword-difficulty, traffic or backlink number in these documents comes from a tool, because none was available.** Where a number appears, it is a count taken from a competitor's own page or from the code.

## Tools that were and were not available
Available: web search, fetching public pages, running the project's tests and TypeScript tooling. Not available: Ahrefs, Semrush, Google Keyword Planner, Google Search Console, WHOIS/registrar lookups, USPTO / trademark registries, Lighthouse/PageSpeed, `npm install` (no network from the sandbox), a production build.
