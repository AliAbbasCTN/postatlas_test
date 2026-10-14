import test from "node:test";
import assert from "node:assert/strict";
import { matchPublisher, rankPublishers, explainMatch, type MatchCandidate } from "../src/lib/matching.ts";
import { calculateAuthorityGap, compareOpportunities } from "../src/lib/opportunity.ts";

const cand = (o: Partial<MatchCandidate> = {}): MatchCandidate => ({
  websiteId: "w1", domain: "a.test", niche: "Technology", country: "United States", priceGuestPost: 100, priceLinkInsertion: null,
  turnaroundMin: 3, turnaroundMax: 5, linkType: "dofollow", metrics: { dr: 70, organicTraffic: 100000, verified: true }, ...o
});

test("exact topic + verified metrics scores higher than unverified", () => {
  const a = matchPublisher({ category: "Technology" }, cand());
  const b = matchPublisher({ category: "Technology" }, cand({ metrics: { dr: 99, organicTraffic: 9e6, verified: false } }));
  assert.ok(a.score > b.score);
  assert.ok(b.cautions.some((c) => /not been verified/.test(c)));
});
test("unverified metrics never add points", () => {
  const withM = matchPublisher({ category: "Technology" }, cand({ metrics: { dr: 99, organicTraffic: 9e6, verified: false } }));
  const without = matchPublisher({ category: "Technology" }, cand({ metrics: null }));
  assert.equal(withM.score, without.score);
});
test("a topic mismatch is excluded, however good the metrics", () => {
  const r = matchPublisher({ category: "Travel" }, cand());
  assert.equal(r.excluded, "topic_mismatch");
});
test("ranking is stable and explained", () => {
  const ranked = rankPublishers({ category: "Technology" }, [cand({ websiteId: "b", domain: "b.test", metrics: null }), cand({ websiteId: "a", domain: "a.test" })]);
  assert.equal(ranked[0].candidate.websiteId, "a");
  assert.match(explainMatch(ranked[0].match), /^Recommended because /);
  assert.ok(!/guarantee|will improve|rank/i.test(explainMatch(ranked[0].match)));
});
test("budget is respected as a caution", () => {
  assert.ok(matchPublisher({ category: "Technology", maxPrice: 50 }, cand()).cautions.some((c) => /above your stated budget/.test(c)));
});

test("authority gap levels are calculated, never invented", () => {
  const high = calculateAuthorityGap(7, 24);
  assert.equal(high.kind, "authority_gap");
  if (high.kind === "authority_gap") { assert.equal(high.level, "HIGH"); assert.equal(high.gap, 17); assert.ok(high.estimatedLinksMin >= 1 && high.estimatedLinksMax >= high.estimatedLinksMin); }
  assert.equal(calculateAuthorityGap(30, 24).kind, "no_gap");
  assert.equal(calculateAuthorityGap(5, 0).kind, "no_gap");
  assert.equal(calculateAuthorityGap(NaN, 10).kind, "no_gap");
  const med = calculateAuthorityGap(10, 18); assert.equal(med.kind === "authority_gap" && med.level, "MEDIUM");
});
test("opportunities sort high first, unranked customer picks last", () => {
  const list = [{ level: null, gap: null }, { level: "LOW" as const, gap: 2 }, { level: "HIGH" as const, gap: 5 }, { level: "HIGH" as const, gap: 20 }];
  list.sort(compareOpportunities);
  assert.deepEqual(list.map((x) => x.gap), [20, 5, 2, null]);
});
