import test from "node:test";
import assert from "node:assert/strict";
import { extractHomeFacts, buildChecklist, summarize, type RawSiteCheck } from "../src/lib/site-signals.ts";
import { html } from "./helpers.ts";

const good = html(`<h1>Hello</h1><img src=a.png alt="a">`, `<title>A sensible page title here</title><meta name="description" content="${"x".repeat(100)}"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://x.test/">`).replace("<html>", `<html lang="en">`);

test("extracts the basics", () => {
  const f = extractHomeFacts(good, "https://x.test/", 200, 400);
  assert.equal(f.title, "A sensible page title here"); assert.equal(f.h1Count, 1); assert.equal(f.hasViewport, true);
  assert.equal(f.lang, "en"); assert.equal(f.imageCount, 1); assert.equal(f.imagesMissingAlt, 0); assert.equal(f.noindex, false);
  assert.equal(f.metaDescription?.length, 100);
});
test("counts images without alt, ignores scripts and comments", () => {
  const f = extractHomeFacts(html(`<!-- <h1>x</h1> --><script>"<h1>"</script><img src=a><img src=b alt=""><img src=c alt="ok">`), "https://x.test/", 200, 1);
  assert.equal(f.h1Count, 0); assert.equal(f.imageCount, 3); assert.equal(f.imagesMissingAlt, 2);
});
test("checklist reports good and improvable items from observations only", () => {
  const raw: RawSiteCheck = { home: extractHomeFacts(good, "https://x.test/", 200, 400), unreachableReason: null, robotsTxt: "found", sitemap: "missing", httpRedirectsToHttps: "found", pages: [] };
  const items = buildChecklist(raw);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.https.state, "good"); assert.equal(byId.title.state, "good"); assert.equal(byId.sitemap.state, "improve");
  const s = summarize(items); assert.ok(s.good > 0 && s.improve === 1 && s.total === items.length);
});
test("http-only, slow, noindex homepage is flagged", () => {
  const raw: RawSiteCheck = { home: extractHomeFacts(html("<p>x</p>", `<meta name="robots" content="noindex">`), "http://x.test/", 200, 4000), unreachableReason: null, robotsTxt: "unknown", sitemap: "unknown", httpRedirectsToHttps: "unknown", pages: [] };
  const byId = Object.fromEntries(buildChecklist(raw).map((i) => [i.id, i]));
  assert.equal(byId.https.state, "improve"); assert.equal(byId.speed.state, "improve"); assert.equal(byId.noindex.state, "improve"); assert.equal(byId.title.state, "improve");
  assert.equal(byId.robots, undefined);
});
test("no promises about rankings in any wording", () => {
  const raw: RawSiteCheck = { home: extractHomeFacts(html("<p>x</p>"), "http://x.test/", 200, 4000), unreachableReason: null, robotsTxt: "missing", sitemap: "missing", httpRedirectsToHttps: "missing", pages: [] };
  for (const i of buildChecklist(raw)) assert.ok(!/will (rank|improve|boost)|guarantee/i.test(i.detail), i.detail);
});
test("an unreachable site yields no checklist", () => {
  assert.deepEqual(buildChecklist({ home: null, unreachableReason: "dns", robotsTxt: "unknown", sitemap: "unknown", httpRedirectsToHttps: "unknown", pages: [] }), []);
});
