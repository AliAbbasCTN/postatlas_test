import test from "node:test";
import assert from "node:assert/strict";
import { createAhrefsProvider, mapHistory } from "../src/lib/seo/ahrefs.ts";
import { pickReusableOverview } from "../src/lib/seo/reuse.ts";
import { unavailableOverview } from "../src/lib/seo/types.ts";

// FIXTURES, not recorded provider responses: they follow the field names in Ahrefs' published API v3 reference.
// These tests prove PostAtlas's handling (mapping, partial data, failures); they do not prove the live API matches.
const NOW = () => new Date("2026-10-10T12:00:00Z");
type Route = (path: string, params: URLSearchParams) => { status?: number; body?: unknown } | "timeout" | "network";

function provider(route: Route, apiKey: string | undefined = "secret-key") {
  const calls: { path: string; params: URLSearchParams; auth: string }[] = [];
  const p = createAhrefsProvider({
    apiKey, now: NOW, timeoutMs: 50,
    fetchImpl: async (url, init) => {
      const u = new URL(url);
      const path = u.pathname.replace("/v3/site-explorer/", "");
      calls.push({ path, params: u.searchParams, auth: init.headers.Authorization });
      const r = route(path, u.searchParams);
      if (r === "network") throw new Error("ECONNRESET");
      if (r === "timeout") return new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      const status = r.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {} };
    }
  });
  return { p, calls };
}

const full: Route = (path, q) => {
  switch (path) {
    case "domain-rating": return { body: { domain_rating: { domain_rating: 61.4, ahrefs_rank: 5000 } } };
    case "backlinks-stats": return { body: { metrics: { live: 1200, all_time: 3400, live_refdomains: 210, all_time_refdomains: 400 } } };
    case "refdomains-history": return { body: { refdomains: [{ date: "2026-08-01", refdomains: 190 }, { date: "2026-09-01", refdomains: 205 }] } };
    case "domain-rating-history": return { body: { domain_ratings: [{ date: "2026-08-01", domain_rating: 60 }, { date: "2026-09-01", domain_rating: 61 }] } };
    case "metrics": return { body: { metrics: { org_traffic: 8200, org_keywords: 950 } } };
    case "metrics-history": return { body: { metrics: [{ date: "2026-08-01", org_traffic: 7000 }, { date: "2026-09-01", org_traffic: 8200 }] } };
    case "metrics-by-country": return { body: { metrics: [{ country: "us", org_traffic: 6000, org_keywords: 500 }, { country: "pk", org_traffic: 2000, org_keywords: 90 }, { country: "xx", org_traffic: 0 }] } };
    case "top-pages": return { body: { pages: [{ url: "https://x.test/a", sum_traffic: 900, keywords: 40, top_keyword: "alpha" }] } };
    case "organic-keywords": return { body: { keywords: [{ keyword: "alpha", best_position: 3, volume: 1000, sum_traffic: 300, best_position_url: "https://x.test/a" }] } };
    case "organic-competitors": return { body: { competitors: [{ competitor_domain: "rival.test" }] } };
    case "refdomains": return q.get("target") === "rival.test"
      ? { body: { refdomains: [{ domain: "news.example", domain_rating: 80, links_to_target: 3 }, { domain: "shared.example", domain_rating: 70, links_to_target: 1 }] } }
      : { body: { refdomains: [{ domain: "shared.example" }] } };
    default: return { status: 404 };
  }
};

test("not configured: every section is unavailable with reason no_provider and NO network call is made", async () => {
  const { p, calls } = provider(full, "");
  assert.equal(p.isConfigured(), false);
  const o = await p.fetchOverview("x.test");
  for (const s of [o.authority, o.organic, o.gap]) assert.deepEqual([s.status, (s as { reason?: string }).reason], ["unavailable", "no_provider"]);
  assert.equal(calls.length, 0);
});
test("configured: maps authority, organic and gap with provider + date, key only in the Authorization header", async () => {
  const { p, calls } = provider(full);
  const o = await p.fetchOverview("x.test");
  assert.equal(o.authority.status, "ok");
  if (o.authority.status !== "ok") return;
  assert.equal(o.authority.value.domainRating, 61.4);
  assert.deepEqual(o.authority.value.referringDomains, { live: 210, allTime: 400 });
  assert.equal(o.authority.value.refDomainsHistory.length, 2);
  assert.equal(o.authority.provider, "ahrefs"); assert.equal(o.authority.asOf, "2026-10-10T12:00:00.000Z");
  assert.ok(calls.every((c) => c.auth === "Bearer secret-key" && !c.params.toString().includes("secret-key")));
  if (o.organic.status !== "ok") throw new Error("organic");
  assert.equal(o.organic.value.estimatedTraffic, 8200);
  assert.deepEqual(o.organic.value.countries.map((c) => c.country), ["US", "PK"]);       // zero-traffic country dropped
  assert.equal(Math.round(o.organic.value.countries[0].share! * 100), 75);
  assert.equal(o.organic.value.topKeywords[0].position, 3);
  if (o.gap.status !== "ok") throw new Error("gap");
  assert.equal(o.gap.value.competitor, "rival.test");
  assert.deepEqual(o.gap.value.opportunities.map((x) => x.domain), ["news.example"]);       // shared.example already links to us
  assert.match(o.gap.value.note, /sample/i);
});
test("incomplete data: missing fields become null (never 0) and the rest still shows", async () => {
  const { p } = provider((path) => path === "domain-rating" ? { body: { domain_rating: { domain_rating: 40 } } } : path === "backlinks-stats" ? { body: { metrics: {} } } : { status: 404 });
  const o = await p.fetchOverview("x.test");
  assert.equal(o.authority.status, "ok");
  if (o.authority.status !== "ok") return;
  assert.equal(o.authority.value.domainRating, 40);
  assert.equal(o.authority.value.referringDomains.live, null);
  assert.equal(o.authority.value.backlinks.allTime, null);
  assert.deepEqual(o.authority.value.refDomainsHistory, []);
});
test("provider has nothing for the domain -> unavailable no_data, not a card of zeros", async () => {
  const { p } = provider((path) => path === "domain-rating" || path === "backlinks-stats" ? { body: {} } : { status: 404 });
  const o = await p.fetchOverview("x.test");
  assert.deepEqual([o.authority.status, (o.authority as { reason?: string }).reason], ["unavailable", "no_data"]);
});
test("401/403 -> plan_or_key; 429 -> rate_limited; 500 -> provider_error; network error -> provider_error", async () => {
  for (const [status, reason] of [[401, "plan_or_key"], [403, "plan_or_key"], [429, "rate_limited"], [500, "provider_error"]] as const) {
    const o = await provider(() => ({ status })).p.fetchOverview("x.test");
    for (const s of [o.authority, o.organic]) assert.deepEqual([s.status, (s as { reason?: string }).reason], ["unavailable", reason], String(status));
  }
  const n = await provider(() => "network").p.fetchOverview("x.test");
  assert.equal((n.authority as { reason?: string }).reason, "provider_error");
});
test("timeout is reported as timeout and does not hang", async () => {
  const t = Date.now();
  const o = await provider(() => "timeout").p.fetchOverview("x.test");
  assert.equal((o.authority as { reason?: string }).reason, "timeout");
  assert.ok(Date.now() - t < 2000);
});
test("one failing section does not blank the others (partial report)", async () => {
  const { p } = provider((path, q) => path === "metrics" || path === "metrics-by-country" || path === "top-pages" ? { status: 429 } : full(path, q));
  const o = await p.fetchOverview("x.test");
  assert.equal(o.authority.status, "ok");
  assert.equal(o.organic.status === "ok" || (o.organic as { reason?: string }).reason === "rate_limited", true);
});
test("history mapping drops malformed rows and keeps the most recent points", () => {
  const rows = [{ date: "2026-01-01", v: 1 }, { date: "2026-02-01", v: "x" }, { v: 3 }, { date: "2026-03-01", v: 4 }];
  assert.deepEqual(mapHistory(rows, "v"), [{ date: "2026-01-01", value: 1 }, { date: "2026-03-01", value: 4 }]);
  assert.equal(mapHistory(Array.from({ length: 40 }, (_, i) => ({ date: `2026-01-${i}`, v: i })), "v", 24).length, 24);
  assert.deepEqual(mapHistory(null, "v"), []);
});
test("reuse only picks a stored overview with real data from the same provider", () => {
  const ok = { ...unavailableOverview("ahrefs", "Ahrefs", "no_data", "x"), authority: { status: "ok", value: {} as never, provider: "ahrefs", asOf: "t" } as const };
  const failed = unavailableOverview("ahrefs", "Ahrefs", "rate_limited", "x");
  assert.equal(pickReusableOverview([failed, null, undefined], "ahrefs"), null);
  assert.equal(pickReusableOverview([failed, ok], "ahrefs"), ok);
  assert.equal(pickReusableOverview([ok], "other"), null);
});
test("the API key is only ever read in server-only modules", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const walk = (d: URL): URL[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]);
  for (const f of walk(new URL("../src/", import.meta.url)).filter((x) => /\.(ts|tsx)$/.test(x.pathname))) {
    const src = readFileSync(f, "utf8");
    if (/AHREFS_API_KEY/.test(src)) assert.match(src, /import "server-only"/, `${f.pathname} reads the key but is not server-only`);
    if (/^\s*["']use client["']/.test(src)) assert.ok(!/AHREFS|SEO_PROVIDER/.test(src), `${f.pathname} is client code touching provider config`);
  }
});
