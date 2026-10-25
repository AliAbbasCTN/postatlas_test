import test from "node:test";
import assert from "node:assert/strict";
import { findLink, extractAnchors, normalizeForCompare, extractPageSignals } from "../src/lib/link-check.ts";
import { html } from "./helpers.ts";

const PAGE = "https://publisher.test/post/1";
const T = "https://customer.test/best-tools";

test("finds an exact link and reports dofollow", () => {
  const f = findLink(html(`<a href="${T}">best tools</a>`), PAGE, T, "best tools");
  assert.equal(f.found, true); assert.equal(f.attribute, "dofollow"); assert.equal(f.anchorMatched, true);
});

test("detects nofollow, sponsored and ugc", () => {
  for (const rel of ["nofollow", "sponsored", "ugc", "noopener NoFollow"]) {
    const f = findLink(html(`<a rel="${rel}" href="${T}">x</a>`), PAGE, T);
    assert.notEqual(f.attribute, "dofollow", rel);
  }
  assert.equal(findLink(html(`<a rel="noopener noreferrer" href="${T}">x</a>`), PAGE, T).attribute, "dofollow");
});

test("ignores trailing slash, www, hash and tracking params", () => {
  assert.equal(normalizeForCompare("https://www.customer.test/best-tools/?utm_source=a#top"), normalizeForCompare(T));
  assert.equal(findLink(html(`<a href="https://www.customer.test/best-tools/#x">x</a>`), PAGE, T).found, true);
});

test("a different page on the same site is not a match but is counted", () => {
  const f = findLink(html(`<a href="https://customer.test/other">x</a>`), PAGE, T);
  assert.equal(f.found, false); assert.equal(f.otherLinksToTargetDomain, 1);
});

test("links inside comments, scripts and styles are ignored", () => {
  const body = `<!-- <a href="${T}">c</a> --><script>var s='<a href="${T}">s</a>'</script><style>/*<a href="${T}">*/</style>`;
  assert.equal(findLink(html(body), PAGE, T).found, false);
});

test("resolves relative links and <base href>", () => {
  const a = extractAnchors(html(`<a href="/x">x</a>`, `<base href="https://other.test/dir/">`), PAGE);
  assert.equal(a[0].resolvedHref, "https://other.test/x");
});

test("handles single-quoted, unquoted attributes and entities", () => {
  const f = findLink(html(`<a href='${T}?a=1&amp;b=2' rel=nofollow>x</a>`), PAGE, `${T}?a=1&b=2`);
  assert.equal(f.found, true); assert.equal(f.attribute, "nofollow");
});

test("anchor text mismatch is reported", () => {
  const f = findLink(html(`<a href="${T}">click here</a>`), PAGE, T, "best tools");
  assert.equal(f.anchorMatched, false);
});

test("page signals: noindex and nofollow robots meta, canonical", () => {
  const s = extractPageSignals(html("", `<meta name="robots" content="noindex, nofollow"><link rel="canonical" href="/c">`), PAGE);
  assert.equal(s.noindex, true); assert.equal(s.nofollowAll, true); assert.equal(s.canonical, "https://publisher.test/c");
  assert.equal(extractPageSignals(html(""), PAGE).noindex, false);
});

test("malformed HTML does not throw or hang", () => {
  const evil = "<a ".repeat(20000) + "<a href=" + "\"".repeat(5000);
  const t = Date.now();
  findLink(evil, PAGE, T);
  assert.ok(Date.now() - t < 2000);
});

import { extractTitle, extractInternalLinks } from "../src/lib/link-check.ts";
test("extractTitle decodes entities and trims", () => {
  assert.equal(extractTitle(html("", "<title>  Tools &amp; Tips \n</title>")), "Tools & Tips");
  assert.equal(extractTitle(html("")), null);
});
test("extractInternalLinks keeps same-site pages only and drops assets and fragments", () => {
  const h = html(`<a href="/a#x">a</a><a href="https://www.site.test/b">b</a><a href="https://other.test/c">c</a><a href="/logo.png">i</a><a href="mailto:x@y.z">m</a>`);
  assert.deepEqual(extractInternalLinks(h, "https://site.test/", "site.test"), ["https://site.test/a", "https://www.site.test/b"]);
});
