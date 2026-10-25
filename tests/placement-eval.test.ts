import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFetch, classify, decideMonitoring, type FetchOutcome, type CheckExpectation } from "../src/lib/placement-eval.ts";
import { html } from "./helpers.ts";

const exp: CheckExpectation = { publishedUrl: "https://pub.test/p", targetUrl: "https://c.test/t", anchorText: "tools", linkType: "dofollow" };
const ok = (body: string, status = 200, finalUrl = exp.publishedUrl, head = ""): FetchOutcome => ({ kind: "ok", status, finalUrl, html: html(body, head), responseMs: 10 });

test("verified when link, anchor and attribute are as expected", () => {
  assert.equal(evaluateFetch(ok(`<a href="https://c.test/t">tools</a>`), exp).status, "VERIFIED");
});
test("missing link", () => assert.equal(evaluateFetch(ok(`<p>nothing</p>`), exp).status, "LINK_MISSING"));
test("wrong target page on same domain => LINK_CHANGED", () => {
  const r = evaluateFetch(ok(`<a href="https://c.test/other">tools</a>`), exp);
  assert.equal(r.status, "LINK_CHANGED"); assert.equal(r.reason, "target_url_changed");
});
test("nofollow when dofollow was sold => LINK_CHANGED", () => {
  const r = evaluateFetch(ok(`<a rel="nofollow" href="https://c.test/t">tools</a>`), exp);
  assert.equal(r.status, "LINK_CHANGED"); assert.equal(r.reason, "attribute_changed");
});
test("page-wide nofollow robots meta counts as nofollow", () => {
  const r = evaluateFetch(ok(`<a href="https://c.test/t">tools</a>`, 200, exp.publishedUrl, `<meta name="robots" content="nofollow">`), exp);
  assert.equal(r.status, "LINK_CHANGED");
});
test("nofollow is fine when the listing is nofollow or mixed", () => {
  for (const linkType of ["nofollow", "mixed", null] as const) {
    assert.equal(evaluateFetch(ok(`<a rel="nofollow" href="https://c.test/t">tools</a>`), { ...exp, linkType }).status, "VERIFIED");
  }
});
test("anchor change", () => {
  assert.equal(evaluateFetch(ok(`<a href="https://c.test/t">here</a>`), exp).reason, "anchor_changed");
});
test("noindex does not fail verification but is flagged, and never claims indexing", () => {
  const r = evaluateFetch(ok(`<a href="https://c.test/t">tools</a>`, 200, exp.publishedUrl, `<meta name="robots" content="noindex">`), exp);
  assert.equal(r.status, "VERIFIED"); assert.equal(r.noindexDetected, true);
  assert.ok(!/indexed/i.test(evaluateFetch(ok(`<a href="https://c.test/t">tools</a>`), exp).message));
});
test("404/410 => PAGE_UNAVAILABLE (hard); 5xx and timeouts are transient", () => {
  assert.equal(classify(evaluateFetch(ok("", 404), exp)), "hard");
  assert.equal(classify(evaluateFetch(ok("", 410), exp)), "hard");
  assert.equal(classify(evaluateFetch(ok("", 503), exp)), "soft");
  assert.equal(classify(evaluateFetch({ kind: "unreachable", reason: "timeout" }, exp)), "soft");
});
test("bot protection and unusual responses are inconclusive, not failures", () => {
  assert.equal(classify(evaluateFetch(ok("", 403), exp)), "inconclusive");
  assert.equal(classify(evaluateFetch(ok("", 429), exp)), "inconclusive");
  assert.equal(classify(evaluateFetch({ kind: "unreachable", reason: "blocked" }, exp)), "inconclusive");
});
test("off-site redirect needs review", () => {
  assert.equal(evaluateFetch(ok(`<a href="https://c.test/t">tools</a>`, 200, "https://evil.test/"), exp).status, "REQUIRES_REVIEW");
});
test("www redirect on same host is fine", () => {
  assert.equal(evaluateFetch(ok(`<a href="https://c.test/t">tools</a>`, 200, "https://www.pub.test/p"), exp).status, "VERIFIED");
});

test("monitoring: one bad check never raises an issue; two hard ones do", () => {
  let s = { consecutiveFailures: 0, orderIsIssue: false };
  let d = decideMonitoring(s, "hard"); assert.equal(d.action, "none"); s = { ...s, consecutiveFailures: d.nextFailures };
  d = decideMonitoring(s, "hard"); assert.equal(d.action, "raise_issue");
});
test("monitoring: soft failures need three; success resets", () => {
  let s = { consecutiveFailures: 0, orderIsIssue: false };
  for (let i = 0; i < 2; i++) { const d = decideMonitoring(s, "soft"); assert.equal(d.action, "none"); s = { ...s, consecutiveFailures: d.nextFailures }; }
  assert.equal(decideMonitoring(s, "soft").action, "raise_issue");
  assert.equal(decideMonitoring(s, "ok").nextFailures, 0);
});
test("monitoring: inconclusive changes nothing; recovery clears an issue", () => {
  assert.deepEqual(decideMonitoring({ consecutiveFailures: 1, orderIsIssue: false }, "inconclusive"), { nextFailures: 1, action: "none" });
  assert.equal(decideMonitoring({ consecutiveFailures: 3, orderIsIssue: true }, "ok").action, "recover");
  assert.equal(decideMonitoring({ consecutiveFailures: 3, orderIsIssue: true }, "hard").action, "none");
});
