import test from "node:test";
import assert from "node:assert/strict";
import { extractHeadings, parseRobotsTxt, parseSitemapXml, buildTechnicalFindings, computeTechnicalScore, assembleTechnicalReport, observePage, xRobotsIsNoindex, type TechnicalInput } from "../src/lib/seo/technical.ts";
import { extractHomeFacts } from "../src/lib/site-signals.ts";
import { html } from "./helpers.ts";

const goodHtml = html(`<h1>Hi</h1><h2>A</h2><h3>B</h3><a href="/x">x</a><img src=a alt="a">`, `<title>A sensible page title here</title><meta name="description" content="${"d".repeat(100)}"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://x.test/">`).replace("<html>", `<html lang="en">`);
function input(over: Partial<TechnicalInput> = {}, htmlStr = goodHtml, final = "https://x.test/"): TechnicalInput {
  return {
    finalUrl: final, status: 200, responseMs: 300, redirects: [], xRobotsTag: null,
    home: extractHomeFacts(htmlStr, final, 200, 300), headings: extractHeadings(htmlStr),
    robotsTxt: "found", robots: { blocksAllCrawlers: false, sitemapDirectives: ["https://x.test/sitemap.xml"], disallowRules: 1 },
    sitemap: "found", sitemapInfo: { kind: "urlset", entries: 10 }, httpRedirectsToHttps: "found",
    internalLinkCount: 5, pages: [], brokenLinks: [], sampledLinks: 4, ...over
  };
}
const ids = (i: TechnicalInput) => buildTechnicalFindings(i).map((f) => f.id);

test("headings: counts, outline, skipped levels, ignores scripts and comments", () => {
  const h = extractHeadings(`<!-- <h1>no</h1> --><script>"<h1>no</h1>"</script><h1>Main &amp; more</h1><h3>Skip</h3><h2>Ok</h2>`);
  assert.equal(h.h1, 1); assert.equal(h.h2, 1); assert.equal(h.h3, 1);
  assert.equal(h.skippedLevels, true);
  assert.deepEqual(h.outline[0], { level: 1, text: "Main & more" });
});
test("robots.txt: blanket disallow for * is detected, other agents and partial disallows are not", () => {
  assert.equal(parseRobotsTxt("User-agent: *\nDisallow: /").blocksAllCrawlers, true);
  assert.equal(parseRobotsTxt("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private").blocksAllCrawlers, false);
  assert.equal(parseRobotsTxt("User-agent: *\nDisallow:").blocksAllCrawlers, false);
  const r = parseRobotsTxt("# c\nUser-agent: *\nDisallow: /a\nSitemap: https://x.test/s.xml\nSitemap: javascript:alert(1)");
  assert.deepEqual(r.sitemapDirectives, ["https://x.test/s.xml"]); assert.equal(r.disallowRules, 1);
});
test("sitemap xml: urlset vs index, entry counts", () => {
  assert.deepEqual(parseSitemapXml("<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>"), { kind: "urlset", entries: 2 });
  assert.equal(parseSitemapXml("<sitemapindex><sitemap><loc>a</loc></sitemap></sitemapindex>").kind, "index");
  assert.equal(parseSitemapXml("hello").kind, "unknown");
});
test("a healthy site has no findings and scores 100", () => {
  assert.deepEqual(buildTechnicalFindings(input()), []);
  assert.equal(computeTechnicalScore([]), 100);
});
test("noindex via meta or X-Robots-Tag, http-only, blocked robots and missing basics are all reported with evidence", () => {
  const bad = html("<p>x</p>", `<meta name="robots" content="noindex">`);
  const i = input({ xRobotsTag: "noindex, nofollow", robots: { blocksAllCrawlers: true, sitemapDirectives: [], disallowRules: 1 }, httpRedirectsToHttps: "missing", sitemap: "missing", robotsTxt: "found", responseMs: 4000 }, bad, "http://x.test/");
  const f = buildTechnicalFindings(i);
  const got = f.map((x) => x.id);
  for (const id of ["https_missing", "homepage_noindex", "robots_blocks_all", "http_no_redirect", "sitemap_missing", "title_missing", "meta_description_missing", "h1_missing", "viewport_missing", "slow_response", "canonical_missing"]) assert.ok(got.includes(id), id);
  assert.match(f.find((x) => x.id === "homepage_noindex")!.evidence, /Both/);
  for (const x of f) { assert.ok(x.evidence && x.recommendation); assert.ok(!/will (rank|improve|boost)|guarantee/i.test(x.evidence + x.recommendation)); }
});
test("canonical comparison ignores www, trailing slash and case but flags a real difference", () => {
  const withCanon = (c: string) => html("<h1>x</h1>", `<title>A sensible page title here</title><link rel="canonical" href="${c}">`);
  assert.ok(!ids(input({}, withCanon("https://WWW.x.test"))).includes("canonical_mismatch"));
  assert.ok(ids(input({}, withCanon("https://x.test/other"))).includes("canonical_mismatch"));
});
test("redirect chains: one hop is fine, two or more is a warning", () => {
  assert.ok(!ids(input({ redirects: [{ from: "a", to: "b", status: 301 }] })).includes("redirect_chain"));
  assert.ok(ids(input({ redirects: [{ from: "a", to: "b", status: 301 }, { from: "b", to: "c", status: 302 }] })).includes("redirect_chain"));
});
test("broken links and page-level findings", () => {
  const pages = [
    observePage("https://x.test/a", 200, html("<p>x</p>", "<title>Same</title>")),
    observePage("https://x.test/b", 200, html("<h1>b</h1>", "<title>Same</title>")),
    observePage("https://x.test/c", 404, null), observePage("https://x.test/d", 500, null), observePage("https://x.test/e", null, null)
  ];
  const f = buildTechnicalFindings(input({ pages, brokenLinks: [{ url: "https://x.test/gone", status: 404, foundOn: "https://x.test/" }], sampledLinks: 6 }));
  const got = f.map((x) => x.id);
  for (const id of ["broken_internal_links", "duplicate_titles", "page_client_error", "page_server_error", "page_unreachable", "page_h1_missing"]) assert.ok(got.includes(id), id);
  assert.match(f.find((x) => x.id === "broken_internal_links")!.evidence, /1 of 6 sampled/);
});
test("score: documented weights, floor at 0, repeated page findings capped at 3", () => {
  const mk = (severity: "critical" | "warning" | "notice", scope: "site" | "page" = "site") => ({ id: `${severity}${scope}`, severity, scope, title: "", evidence: "", recommendation: "" });
  assert.equal(computeTechnicalScore([mk("critical"), mk("warning"), mk("notice")]), Math.round(100 - 15 - 6 - 1.5));
  assert.equal(computeTechnicalScore(Array.from({ length: 10 }, () => mk("critical"))), 0);
  assert.equal(computeTechnicalScore(Array.from({ length: 10 }, () => mk("warning", "page"))), 100 - 18);
});
test("assembled report: indexability reasons, formula is present and distinct from third-party metrics", () => {
  const r = assembleTechnicalReport(input({ xRobotsTag: "noindex" }), "2026-10-10T00:00:00Z");
  assert.equal(r.indexability.indexable, false); assert.deepEqual(r.indexability.reasons, ["X-Robots-Tag header contains noindex"]);
  assert.match(r.score.formula, /not Domain Rating, Domain Authority/);
  assert.equal(xRobotsIsNoindex("index, follow"), false);
});
