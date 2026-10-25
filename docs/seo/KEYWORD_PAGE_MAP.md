# Keyword-to-page map and anti-cannibalisation rules

One primary intent per URL. A page may mention neighbouring terms naturally but must not be optimised for another page's primary keyword.

| URL | Status | Primary intent and keyword cluster | Title (before " \| PostAtlas") | H1 | Why this page |
|---|---|---|---|---|---|
| `/` | existing, rewritten | Brand + the main proposition: **guest post marketplace / backlink marketplace** (commercial) | PostAtlas: guest post and backlink marketplace with verified placements (absolute) | Guest post and backlink marketplace where every link is verified | The homepage states the whole proposition and links to every service page. It does not carry "buy guest posts" or "link insertion" as targets. |
| `/buy-guest-posts` | **new** | **buy guest posts**, paid / sponsored guest post, guest post service (transactional) | Buy guest posts on approved publisher websites | Buy guest posts on websites our team has approved | The transactional page: ordering flow, what to check, what happens if it goes wrong. |
| `/link-insertion-service` | **new** | **link insertion service**, niche edits, buy link insertions (transactional) | Link insertion service (niche edits) for existing articles | Link insertions: add your link to an article that is already published | A distinct product with its own risks and ordering inputs. |
| `/backlink-monitoring` | **new** | **backlink monitoring / verification**, check if a backlink is live (commercial + informational) | Backlink verification and monitoring for every placement | Backlink verification and monitoring, built into every order | The clearest differentiator, and a feature competitors do not explain. |
| `/guest-post-vs-link-insertion` | **new** (article) | **guest post vs link insertion**, what is a niche edit (informational) | Guest post vs link insertion: which should you buy? | same as title | Top-of-funnel comparison that feeds both transactional pages. |
| `/publishers` | existing | **publisher discovery**, explore sites, publisher marketplace (commercial) | Explore sites you can publish on | Explore sites you can publish on | The catalogue. Filters/pagination are canonicalised. |
| `/publishers/category/[niche]` | existing, generated | "{niche} guest post sites" (commercial) | per niche | per niche | Only generated when 3+ approved sites exist, so no thin pages. |
| `/publishers/[domain]` | existing | the individual website (navigational) | per site | per site | Now shows verified-buyer rating and reviews. |
| `/check` | existing, retitled | **free website SEO check**, on-page checker (tool) | Free website SEO check: titles, headings, mobile, indexability | per page | The title now states what the tool really checks. |
| `/for-publishers` | existing | **sell guest posts, monetize a website** (publisher side) | For publishers: list your website and receive placement orders | per page | The supply-side page. |
| `/how-it-works`, `/pricing` | existing | process / "how does buying work", pricing model | existing | existing | Now link to the service pages. |
| `/blog`, `/blog/[slug]` | existing | informational long tail | per article | per article | Add articles only with real expertise. |
| `/privacy`, `/terms`, `/refund-policy` | existing | policies (trust) | existing | existing | Linked from every landing page. |

## Anti-cannibalisation rules
1. A keyword's **owner** is the row above. Do not put the owner's keyword in another page's title or H1.
2. `/buy-guest-posts` (guest post) and `/link-insertion-service` (link insertion) are separate products. The comparison article links to both and targets only the "vs" query.
3. Links between pages use descriptive anchors ("buy guest posts", "link insertions", "backlink monitoring") so each destination keeps one clear topic.
4. Titles, descriptions and H1s are unique across the whole site. A test (`tests/seo.test.ts`) fails if two landing pages share any of them.
5. The homepage never competes for "buy guest posts" or "link insertion". It links to those pages in the "What you can order" section.
