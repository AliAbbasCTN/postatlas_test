import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchFreeDomainRating, AHREFS_FREE_URL } from "../src/lib/seo/ahrefs-free.ts";
import { createAhrefsFreeProvider } from "../src/lib/seo/ahrefs-free-provider.ts";
import { createAhrefsProvider } from "../src/lib/seo/ahrefs.ts";
import { drBand, drRing, clampDr } from "../src/lib/seo/dr.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const NOW = () => new Date("2026-10-24T10:00:00Z");
type Call = { url: URL; auth: string };
const fake = (handler: (u: URL) => { status: number; body?: unknown } | "throw") => {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
    const u = new URL(url); calls.push({ url: u, auth: init.headers.Authorization });
    const r = handler(u); if (r === "throw") throw new Error("network");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetchImpl, calls };
};
const ok = (dr: unknown) => ({ status: 200, body: { domain_rating: { domain_rating: dr, license: "https://ahrefs.com/legal/domain-rating-license" } } });

test("free endpoint: correct URL, key only in the Authorization header, DR mapped, marked DR-only", async () => {
  const { fetchImpl, calls } = fake(() => ok(46.0));
  const s = await fetchFreeDomainRating("example.com", { apiKey: "free-key", fetchImpl, now: NOW });
  assert.equal(calls.length, 1);
  assert.equal(`${calls[0].url.origin}${calls[0].url.pathname}`, AHREFS_FREE_URL);
  assert.equal(AHREFS_FREE_URL, "https://api.ahrefs.com/v3/public/domain-rating-free");
  assert.equal(calls[0].url.searchParams.get("target"), "example.com"); assert.equal(calls[0].url.searchParams.get("version"), "dr3"); assert.equal(calls[0].url.searchParams.get("output"), "json");
  assert.equal(calls[0].auth, "Bearer free-key"); assert.ok(!calls[0].url.toString().includes("free-key"));
  assert.equal(s.status, "ok");
  if (s.status === "ok") { assert.equal(s.value.domainRating, 46); assert.equal(s.value.drOnly, true); assert.equal(s.value.backlinks.live, null); assert.equal(s.provider, "ahrefs"); assert.equal(s.asOf, "2026-10-24T10:00:00.000Z"); }
});

test("a real DR of 0 is shown as 0 (a brand-new site), never treated as missing", async () => {
  const s = await fetchFreeDomainRating("new.example", { apiKey: "k", fetchImpl: fake(() => ok(0)).fetchImpl, now: NOW });
  assert.equal(s.status, "ok"); if (s.status === "ok") assert.equal(s.value.domainRating, 0);
});

test("failures are reported with a reason, never as a made-up number", async () => {
  const run = (h: Parameters<typeof fake>[0]) => fetchFreeDomainRating("example.com", { apiKey: "k", fetchImpl: fake(h).fetchImpl, now: NOW });
  const reason = async (h: Parameters<typeof fake>[0]) => { const s = await run(h); assert.equal(s.status, "unavailable"); return s.status === "unavailable" ? s.reason : ""; };
  assert.equal(await reason(() => ({ status: 401 })), "plan_or_key"); assert.equal(await reason(() => ({ status: 403 })), "plan_or_key");
  assert.equal(await reason(() => ({ status: 429 })), "rate_limited"); assert.equal(await reason(() => ({ status: 500 })), "provider_error");
  assert.equal(await reason(() => "throw"), "provider_error");
  for (const bad of [null, "46", -1, 101, Number.NaN, undefined]) assert.equal(await reason(() => ok(bad)), "no_data", String(bad));
  assert.equal(await reason(() => ({ status: 200, body: {} })), "no_data");
  assert.equal(await reason(() => ({ status: 200, body: null })), "no_data");
});

test("no key means no network call", async () => {
  const { fetchImpl, calls } = fake(() => ok(10));
  const s = await fetchFreeDomainRating("example.com", { apiKey: undefined, fetchImpl, now: NOW });
  assert.equal(calls.length, 0); assert.equal(s.status, "unavailable");
});

test("a slow answer is a timeout, not a hang", async () => {
  const fetchImpl = (_u: string, init: { signal: AbortSignal }) => new Promise<never>((_, rej) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }));
  const s = await fetchFreeDomainRating("example.com", { apiKey: "k", fetchImpl: fetchImpl as never, timeoutMs: 20, now: NOW });
  assert.equal(s.status, "unavailable"); if (s.status === "unavailable") assert.equal(s.reason, "timeout");
});

test("ahrefs-free provider: DR from the free endpoint; traffic, keywords and gap say they need a paid plan", async () => {
  const { fetchImpl, calls } = fake(() => ok(61));
  const p = createAhrefsFreeProvider({ apiKey: "k", fetchImpl, now: NOW });
  assert.equal(p.id, "ahrefs-free"); assert.equal(p.isConfigured(), true);
  const o = await p.fetchOverview("example.com");
  assert.equal(calls.length, 1, "exactly one request, and it is the free one");
  assert.equal(o.authority.status, "ok"); if (o.authority.status === "ok") assert.equal(o.authority.value.domainRating, 61);
  for (const sec of [o.organic, o.gap]) { assert.equal(sec.status, "unavailable"); if (sec.status === "unavailable") assert.equal(sec.reason, "not_supported"); }
  const none = await createAhrefsFreeProvider({ apiKey: undefined, now: NOW }).fetchOverview("example.com");
  assert.equal(none.authority.status, "unavailable");
});

test("THE BUG: a free key is refused by the paid Site Explorer endpoint, so the full provider now falls back to the free endpoint and still shows DR", async () => {
  const { fetchImpl, calls } = fake((u) => u.pathname.startsWith("/v3/site-explorer/") ? { status: 403 } : ok(38));
  const o = await createAhrefsProvider({ apiKey: "free-key", fetchImpl, now: NOW }).fetchOverview("example.com");
  assert.equal(o.authority.status, "ok");
  if (o.authority.status === "ok") { assert.equal(o.authority.value.domainRating, 38); assert.equal(o.authority.value.drOnly, true); }
  assert.ok(calls.some((c) => c.url.pathname === "/v3/public/domain-rating-free"));
  assert.ok(calls.every((c) => c.auth === "Bearer free-key"));
  assert.equal(o.organic.status, "unavailable"); // paid sections are still honestly unavailable
});

test("the full provider with a paid plan is unchanged: its own DR is used and the free endpoint is not called", async () => {
  const { fetchImpl, calls } = fake((u) => {
    const p = u.pathname.split("/").pop();
    if (p === "domain-rating") return { status: 200, body: { domain_rating: { domain_rating: 72 } } };
    if (p === "backlinks-stats") return { status: 200, body: { metrics: { live: 100, all_time: 200, live_refdomains: 10, all_time_refdomains: 20 } } };
    return { status: 200, body: {} };
  });
  const o = await createAhrefsProvider({ apiKey: "k", fetchImpl, now: NOW }).fetchOverview("example.com");
  assert.equal(o.authority.status, "ok");
  if (o.authority.status === "ok") { assert.equal(o.authority.value.domainRating, 72); assert.equal(o.authority.value.drOnly, undefined); assert.equal(o.authority.value.backlinks.live, 100); }
  assert.ok(!calls.some((c) => c.url.pathname.includes("/public/")));
});

test("when the free endpoint also fails, the paid provider still reports the original reason", async () => {
  const o = await createAhrefsProvider({ apiKey: "k", fetchImpl: fake(() => ({ status: 403 })).fetchImpl, now: NOW }).fetchOverview("example.com");
  assert.equal(o.authority.status, "unavailable"); if (o.authority.status === "unavailable") assert.equal(o.authority.reason, "plan_or_key");
});

test("the provider is selectable by SEO_PROVIDER=ahrefs-free and the key is read only on the server", () => {
  const p = read("src/lib/seo/provider.ts");
  assert.match(p, /choice === "ahrefs-free"\) return createAhrefsFreeProvider/); assert.match(p, /import "server-only"/);
  for (const f of ["src/lib/seo/ahrefs-free.ts", "src/lib/seo/ahrefs-free-provider.ts", "src/lib/seo/dr.ts", "src/components/seo/DomainRatingBadge.tsx"]) assert.ok(!/process\.env/.test(read(f)), `${f} must not read env`);
  assert.match(read(".env.example"), /SEO_PROVIDER: none \(default\) \| ahrefs-free \| ahrefs/);
});

// ---- the ring ----------------------------------------------------------------------------------------------------------------
test("ring geometry: the arc length is exactly DR percent of the circle", () => {
  const full = drRing(100).circumference;
  assert.ok(Math.abs(drRing(50).dash - full / 2) < 1e-9); assert.equal(drRing(0).dash, 0); assert.ok(Math.abs(drRing(100).dash - full) < 1e-9);
  assert.ok(Math.abs(drRing(37).dash + drRing(37).gap - full) < 1e-9);
  assert.equal(clampDr(150), 100); assert.equal(clampDr(-5), 0);
  assert.ok(Math.abs(drRing(250).dash - full) < 1e-9, "out-of-range values are clamped");
});

test("bands are descriptive, cover 0-100 without gaps, and never promise rankings", () => {
  const keys = [0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map((v) => drBand(v).key);
  assert.deepEqual(keys, ["very-low", "very-low", "low", "low", "moderate", "moderate", "strong", "strong", "very-strong", "very-strong"]);
  for (let v = 0; v <= 100; v++) assert.ok(drBand(v).label.length > 0);
});

test("the badge shows the number, a text label, the required Ahrefs attribution and licence link, and the report page uses it first", () => {
  const b = read("src/components/seo/DomainRatingBadge.tsx");
  assert.match(b, /role="img" aria-label=\{`Domain Rating \$\{shown\} out of 100/); assert.match(b, /strokeDasharray=\{`\$\{dash\} \$\{gap\}`\}/);
  assert.match(b, /DR_ATTRIBUTION/); assert.match(b, /href="https:\/\/ahrefs\.com\/"/); assert.match(b, /DR_LICENSE_URL/); assert.match(b, /not a Google ranking factor/);
  assert.equal(read("src/lib/seo/dr.ts").includes('"Domain Rating by Ahrefs"'), true);
  const page = read("src/app/(marketing)/check/[id]/page.tsx");
  assert.match(page, /<DomainRatingBadge value=\{dr\}/); assert.ok(page.indexOf("<DomainRatingBadge") < page.indexOf("<SeoReport"));
  assert.match(read("src/components/seo/SeoReport.tsx"), /a\.drOnly && a\.domainRating !== null/);
});
