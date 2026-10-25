import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolveSiteUrl, indexingAllowed, hostOf } from "../src/lib/site-env.ts";
import { organizationLd, websiteLd, breadcrumbListLd, faqLd, serviceLd, articleLd } from "../src/lib/seo-schema.ts";
import { LANDINGS, LANDING_PATHS } from "../src/lib/landing-pages.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const BRAND = "PostAtlas";
const effectiveTitle = (t: string) => (/postatlas/i.test(t) ? t : `${t} | ${BRAND}`);

// ---- environment: canonical origin and indexing ---------------------------------------------------------------------------
test("SITE_URL wins; preview falls back to its own URL; production without SITE_URL fails loudly; dev uses localhost", () => {
  assert.equal(resolveSiteUrl({ SITE_URL: "https://postatlas.example/", NODE_ENV: "production" }), "https://postatlas.example");
  assert.equal(resolveSiteUrl({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_URL: "postatlas-git-x.vercel.app" }), "https://postatlas-git-x.vercel.app");
  assert.throws(() => resolveSiteUrl({ NODE_ENV: "production" }), /SITE_URL must be set/);
  assert.equal(resolveSiteUrl({ NODE_ENV: "development" }), "http://localhost:3000");
  assert.equal(hostOf("https://Example.COM/x"), "example.com");
});

test("only a real production domain is indexable; test, preview and local hosts never are unless explicitly overridden", () => {
  assert.equal(indexingAllowed({ SITE_URL: "https://postatlas.example", NODE_ENV: "production" }), true);
  assert.equal(indexingAllowed({ SITE_URL: "https://postatlas-test.vercel.app", NODE_ENV: "production" }), false);
  assert.equal(indexingAllowed({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }), false);
  assert.equal(indexingAllowed({ SITE_URL: "http://localhost:3000" }), false);
  assert.equal(indexingAllowed({ NODE_ENV: "production" }), false);                                                  // misconfigured: safe default
  assert.equal(indexingAllowed({ SITE_URL: "https://postatlas-test.vercel.app", ALLOW_INDEXING: "true" }), true);   // deliberate override
  assert.equal(indexingAllowed({ SITE_URL: "https://postatlas.example", ALLOW_INDEXING: "false" }), false);
});

test("robots.txt: blocks everything where indexing is off; on production keeps private areas out and exposes the sitemap", () => {
  const r = read("src/app/robots.ts");
  assert.match(r, /if \(!indexingAllowed\(\)\) return \{ rules: \[\{ userAgent: "\*", disallow: "\/" \}\] \}/);
  for (const p of ["/admin", "/dashboard", "/publisher", "/api/", "/auth/"]) assert.ok(r.includes(`"${p}"`), p);
  assert.match(r, /sitemap: `\$\{base\}\/sitemap\.xml`/);
  assert.ok(!/host:/.test(r), "the host directive is not used by Google");
  assert.ok(!/"\/login"|"\/signup"/.test(r), "noindex pages must stay crawlable so the noindex is seen");
});

test("sitemap: lists every landing page, only public URLs, and is empty where indexing is off", () => {
  const s = read("src/app/sitemap.ts");
  assert.match(s, /\.\.\.LANDING_PATHS/); assert.match(s, /if \(!indexingAllowed\(\)\) return \[\]/);
  for (const bad of ["/dashboard", "/admin", "/login", "/api"]) assert.ok(!new RegExp(`"${bad}`).test(s), bad);
  for (const p of ["/privacy", "/terms", "/refund-policy", "/pricing", "/how-it-works", "/publishers"]) assert.ok(s.includes(`"${p}"`), p);
});

test("private areas stay noindex, no-store and are never in the sitemap", () => {
  for (const f of ["src/app/dashboard/layout.tsx", "src/app/admin/layout.tsx", "src/app/publisher/layout.tsx"]) assert.match(read(f), /robots: \{ index: false, follow: false \}/, f);
  const cfg = read("next.config.mjs");
  assert.match(cfg, /X-Robots-Tag", value: "noindex, nofollow"/); assert.match(cfg, /private, no-store/);
});

// ---- titles, descriptions, canonical ------------------------------------------------------------------------------------------
test("pageMeta never doubles the brand, and emits canonical, Open Graph and a large Twitter card", () => {
  const s = read("src/lib/seo.ts");
  assert.match(s, /\/postatlas\/i\.test\(o\.title\) \? \{ absolute: o\.title \} : o\.title/);
  assert.match(s, /alternates: \{ canonical: url \}/); assert.match(s, /card: "summary_large_image"/); assert.match(s, /images: \[OG_IMAGE\]/);
  assert.match(s, /!indexingAllowed\(\) \? \{ index: false, follow: false \}/);
  assert.equal(effectiveTitle("About PostAtlas"), "About PostAtlas");
  assert.equal(effectiveTitle("Pricing: pay per placement"), "Pricing: pay per placement | PostAtlas");
});

test("every public page title and description is present, unique and a sensible length", () => {
  const dirs = ["", "about", "contact", "for-publishers", "how-it-works", "pricing", "privacy", "terms", "refund-policy", "check", "publishers", "blog"];
  const seen = new Map<string, string>();
  for (const d of dirs) {
    const src = read(`src/app/(marketing)/${d ? d + "/" : ""}page.tsx`);
    const m = src.match(/pageMeta\(\{[\s\S]*?title: (?:page > 1 \? `[^`]*` : )?"([^"]+)"[\s\S]*?description: "([^"]+)"/);
    assert.ok(m, `${d || "home"}: no literal title/description`);
    const title = effectiveTitle(m![1]), desc = m![2];
    assert.ok(title.length <= 75 && title.length >= 15, `${d}: title length ${title.length}`);
    assert.ok(desc.length >= 60 && desc.length <= 170, `${d}: description length ${desc.length}`);
    assert.ok(!seen.has(title), `${d}: title duplicates ${seen.get(title)}`); seen.set(title, d);
    assert.ok(!/PostAtlas.*\| PostAtlas/.test(title), `${d}: brand twice`);
  }
});

// ---- landing pages ------------------------------------------------------------------------------------------------------------------
const ALL = Object.values(LANDINGS);
const ROUTES = ["/", "/check", "/publishers", "/how-it-works", "/pricing", "/for-publishers", "/refund-policy", "/terms", "/privacy", "/about", "/contact", "/blog", ...LANDING_PATHS];
const routeExists = (h: string) => h === "/" ? existsSync(new URL("../src/app/(marketing)/page.tsx", import.meta.url)) : existsSync(new URL(`../src/app/(marketing)${h}/page.tsx`, import.meta.url));

test("each landing page has its own route, unique title, description and H1, and one clear intent", () => {
  assert.equal(ALL.length, LANDING_PATHS.length);
  for (const l of ALL) {
    assert.ok(routeExists(l.path), `${l.path} has no route`);
    assert.ok(effectiveTitle(l.metaTitle).length <= 72, `${l.path} title ${effectiveTitle(l.metaTitle).length}`);
    assert.ok(l.metaDescription.length >= 120 && l.metaDescription.length <= 165, `${l.path} description ${l.metaDescription.length}`);
    assert.ok(l.sections.length >= 3 && l.faqs.length >= 3, l.path);
  }
  for (const key of ["metaTitle", "metaDescription", "h1"] as const) assert.equal(new Set(ALL.map((l) => l[key])).size, ALL.length, `${key} must be unique (no cannibalisation)`);
});

test("target keywords appear in the title and the H1 of the page that owns them", () => {
  const owns: Record<string, RegExp> = { "/buy-guest-posts": /guest posts/i, "/link-insertion-service": /link insertion/i, "/backlink-monitoring": /backlink/i, "/guest-post-vs-link-insertion": /guest post vs link insertion/i };
  for (const [p, re] of Object.entries(owns)) { assert.match(LANDINGS[p].metaTitle, re, p); assert.match(LANDINGS[p].h1, re, p); }
});

test("internal links on landing pages resolve to real pages; every landing page is linked from the footer and the sitemap", () => {
  for (const l of ALL) for (const r of [...l.related, l.cta]) assert.ok(ROUTES.includes(r.href) && routeExists(r.href), `${l.path} links to ${r.href}`);
  const footer = read("src/components/SiteFooter.tsx");
  for (const p of ["/buy-guest-posts", "/link-insertion-service", "/backlink-monitoring"]) assert.ok(footer.includes(`href="${p}"`), p);
  assert.match(read("src/app/(marketing)/page.tsx"), /\/buy-guest-posts/);
});

test("landing and legal copy makes no invented claims (rankings, rankings guarantees, ratings, testimonials, statistics)", () => {
  const text = JSON.stringify(ALL).toLowerCase();
  for (const bad of [/guaranteed (rank|top|#1|traffic)/, /#1\b/, /\bbest\b/, /testimonial/, /\b\d{2,}[,.]?\d*\+? (publishers|websites|sites|customers|clients)\b/, /100%/, /money.back/, /aggregaterating|ratingvalue/, /free backlinks?/]) assert.ok(!bad.test(text), String(bad));
  assert.match(text, /we do not promise rankings|cannot promise that/);
});

test("structured data is valid, links to one Organization, and invents nothing", () => {
  const base = "https://postatlas.example";
  const org = organizationLd(base), web = websiteLd(base);
  assert.equal(org["@type"], "Organization"); assert.equal(org.logo.url, `${base}/apple-touch-icon.png`); assert.equal(web.publisher["@id"], org["@id"]);
  const crumbs = breadcrumbListLd(base, [{ name: "Home", path: "/" }, { name: "X", path: "/x" }]);
  const all = [org, web, crumbs, faqLd([{ q: "q", a: "a" }]),
    serviceLd(base, { name: "n", description: "d", path: "/x", serviceType: "t" }), articleLd(base, { headline: "h", description: "d", path: "/x", datePublished: "2026-10-24", dateModified: "2026-10-24" })];
  for (const o of all) { assert.equal(o["@context"], "https://schema.org"); JSON.parse(JSON.stringify(o)); }
  const blob = JSON.stringify(all);
  for (const bad of ["aggregateRating", "review", "telephone", "address", "sameAs", "offers", "price"]) assert.ok(!blob.includes(`"${bad}"`), bad);
  assert.equal(crumbs.itemListElement[1].item, `${base}/x`);
});

test("pages embed their structured data through the escaping serializer, and the marketing layout emits Organization once", () => {
  assert.match(read("src/components/SeoLanding.tsx"), /jsonLdString\(ld\)/);
  const layout = read("src/app/(marketing)/layout.tsx");
  assert.match(layout, /organizationLd\(base\), websiteLd\(base\)/);
  assert.ok(!/"@type": "Organization"/.test(read("src/app/(marketing)/page.tsx")), "home must not duplicate Organization");
});

test("Open Graph image exists and is a 1200x630 PNG", () => {
  const png = readFileSync(new URL("../public/og-image.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 200_000);
});

test("fonts load from <head> with preconnect, not a render-blocking CSS @import", () => {
  assert.ok(!/@import/.test(read("src/app/globals.css")));
  const l = read("src/app/layout.tsx");
  assert.match(l, /rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/); assert.match(l, /display=swap/);
});

test("the .env.example documents SITE_URL and ALLOW_INDEXING with placeholders only", () => {
  const e = read(".env.example");
  assert.match(e, /ALLOW_INDEXING/); assert.ok(!/(sk_live|eyJ[A-Za-z0-9_-]{20,})/.test(e));
});

test("all marketing routes referenced by the nav and footer exist", () => {
  for (const f of readdirSync(new URL("../src/app/(marketing)/", import.meta.url), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("[")))
    assert.ok(existsSync(new URL(`../src/app/(marketing)/${f.name}/`, import.meta.url)), f.name);
});
