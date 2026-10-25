import "server-only";
import { safeFetch } from "@/lib/safe-fetch";
import { discoverUrls } from "@/lib/services/audit-engine";
import { extractInternalLinks } from "@/lib/link-check";
import { extractHomeFacts, buildChecklist, summarize, type RawSiteCheck, type CheckItem, type Presence } from "@/lib/site-signals";
import { assembleTechnicalReport, extractHeadings, observePage, parseRobotsTxt, parseSitemapXml, type BrokenLink, type PageObservation, type TechnicalReport } from "@/lib/seo/technical";
import type { SeoOverview } from "@/lib/seo/types";

// Public, account-free website check. Every value in `technical` and `pages` is something we actually fetched.
// `seo` (Domain Rating, backlinks, traffic, keywords, gap) is NEVER computed here: it comes only from a configured
// third-party provider (see lib/seo/provider.ts) and is attached by the caller; without one it is marked unavailable.
export type SiteCheckResult = {
  domain: string;
  category: string;
  checkedAt: string;
  reachable: boolean;
  unreachableReason: string | null;
  home: RawSiteCheck["home"];
  robotsTxt: Presence;
  sitemap: Presence;
  httpRedirectsToHttps: Presence;
  pages: RawSiteCheck["pages"];
  checklist: CheckItem[];
  summary: { good: number; improve: number; total: number };
  /** Added with the SEO report upgrade. Absent on reports created before it. */
  technical?: TechnicalReport;
  seo?: SeoOverview;
};

const DEADLINE_MS = 28_000;
const MAX_PAGE_SAMPLE = 7;
const MAX_LINK_SAMPLE = 12;

async function fetchText(url: string, allowed: RegExp, maxBytes: number): Promise<{ presence: Presence; body: string }> {
  const r = await safeFetch(url, { timeoutMs: 5000, maxBytes, accept: "*/*", allowedTypes: allowed });
  if (r.kind !== "ok") return { presence: "unknown", body: "" };
  if (r.status === 200) return { presence: "found", body: r.html };
  return { presence: r.status === 404 || r.status === 410 ? "missing" : "unknown", body: "" };
}

export async function runSiteCheck(domain: string, category: string): Promise<SiteCheckResult> {
  const started = Date.now();
  const origin = `https://${domain}`;
  const home = await safeFetch(`${origin}/`, { timeoutMs: 9000 });

  if (home.kind !== "ok") {
    return { domain, category, checkedAt: new Date().toISOString(), reachable: false, unreachableReason: home.reason, home: null, robotsTxt: "unknown", sitemap: "unknown", httpRedirectsToHttps: "unknown", pages: [], checklist: [], summary: { good: 0, improve: 0, total: 0 } };
  }
  const html = home.status === 200 ? home.html : "";
  const facts = extractHomeFacts(html, home.finalUrl, home.status, home.responseMs);

  const [robots, sitemapFetch, httpCheck] = await Promise.all([
    fetchText(`${origin}/robots.txt`, /(text\/plain|text\/html|application\/octet-stream)/, 300_000),
    fetchText(`${origin}/sitemap.xml`, /(xml|text\/plain)/, 1_000_000),
    safeFetch(`http://${domain}/`, { timeoutMs: 6000, maxBytes: 50_000 })
  ]);
  const httpRedirectsToHttps: Presence = httpCheck.kind === "ok" ? (httpCheck.finalUrl.startsWith("https://") ? "found" : "missing") : "unknown";

  let pages: RawSiteCheck["pages"] = [];
  const observations: PageObservation[] = [];
  const brokenLinks: BrokenLink[] = [];
  let sampledLinks = 0;
  const internal = home.status === 200 ? extractInternalLinks(html, home.finalUrl, domain, 60) : [];

  if (home.status === 200) {
    const urls = (await discoverUrls(domain)).filter((u) => { try { return new URL(u).pathname !== "/"; } catch { return false; } }).slice(0, MAX_PAGE_SAMPLE);
    for (let i = 0; i < urls.length && Date.now() - started < DEADLINE_MS; i += 4) {
      const batch = await Promise.all(urls.slice(i, i + 4).map(async (u) => {
        const r = await safeFetch(u, { timeoutMs: 6000 });
        return r.kind === "ok" ? observePage(u, r.status, r.status === 200 ? r.html : null) : observePage(u, null, null);
      }));
      observations.push(...batch);
      pages = pages.concat(batch.map((p) => ({ url: p.url, status: p.status, title: p.title, noindex: p.noindex })));
    }
    // Broken-link sample: homepage links we have not already fetched. A sample, never presented as a full crawl.
    const seen = new Set(observations.map((o) => o.url));
    const toCheck = internal.filter((u) => !seen.has(u)).slice(0, MAX_LINK_SAMPLE);
    for (let i = 0; i < toCheck.length && Date.now() - started < DEADLINE_MS; i += 4) {
      const batch = await Promise.all(toCheck.slice(i, i + 4).map(async (u) => {
        const r = await safeFetch(u, { timeoutMs: 4000, maxBytes: 60_000 });
        return { u, r };
      }));
      for (const { u, r } of batch) {
        if (r.kind === "ok") { sampledLinks++; if (r.status >= 400) brokenLinks.push({ url: u, status: r.status, foundOn: home.finalUrl }); }
        else if (r.reason === "dns" || r.reason === "timeout" || r.reason === "connection") { sampledLinks++; brokenLinks.push({ url: u, status: null, foundOn: home.finalUrl }); }
        // too_large / not_html mean the target answered; blocked is never counted against the site.
        else if (r.reason === "too_large" || r.reason === "not_html") sampledLinks++;
      }
    }
  }

  const raw: RawSiteCheck = { home: facts, unreachableReason: null, robotsTxt: robots.presence, sitemap: sitemapFetch.presence, httpRedirectsToHttps, pages };
  const checklist = home.status === 200 ? buildChecklist(raw) : [];
  const reachable = home.status === 200;

  const technical = reachable ? assembleTechnicalReport({
    finalUrl: home.finalUrl, status: home.status, responseMs: home.responseMs, redirects: home.redirects ?? [], xRobotsTag: home.headers?.xRobotsTag ?? null,
    home: facts, headings: extractHeadings(html),
    robotsTxt: robots.presence, robots: robots.presence === "found" ? parseRobotsTxt(robots.body) : null,
    sitemap: sitemapFetch.presence, sitemapInfo: sitemapFetch.presence === "found" ? parseSitemapXml(sitemapFetch.body) : null,
    httpRedirectsToHttps, internalLinkCount: internal.length, pages: observations, brokenLinks, sampledLinks
  }, new Date().toISOString()) : undefined;

  return {
    domain, category, checkedAt: new Date().toISOString(), reachable,
    unreachableReason: reachable ? null : `http_${home.status}`,
    home: facts, robotsTxt: robots.presence, sitemap: sitemapFetch.presence, httpRedirectsToHttps, pages, checklist, summary: summarize(checklist),
    technical
  };
}
