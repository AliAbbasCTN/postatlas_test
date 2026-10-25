// Technical SEO analysis for the public website report. Pure functions only (no I/O) so every rule is unit tested.
// Everything here describes what a fetch OBSERVED. Nothing is estimated, and nothing claims a ranking effect.
import { extractPageSignals } from "../link-check.ts";
import type { HomeFacts, Presence } from "../site-signals.ts";

export type Severity = "critical" | "warning" | "notice";
export type Finding = {
  id: string;
  severity: Severity;
  scope: "site" | "page";
  title: string;
  /** What was actually observed. */
  evidence: string;
  /** What to do about it. Never a promise about rankings. */
  recommendation: string;
  url?: string;
};

export type Redirect = { from: string; to: string; status: number };
export type Heading = { level: number; text: string };
export type HeadingInfo = { h1: number; h2: number; h3: number; outline: Heading[]; skippedLevels: boolean };
export type RobotsInfo = { blocksAllCrawlers: boolean; sitemapDirectives: string[]; disallowRules: number };
export type SitemapInfo = { kind: "index" | "urlset" | "unknown"; entries: number };
export type PageObservation = {
  url: string; status: number | null; title: string | null; metaDescription: string | null;
  h1Count: number | null; canonical: string | null; noindex: boolean | null; internalLinks: number | null;
};
export type BrokenLink = { url: string; status: number | null; foundOn: string };

export type TechnicalInput = {
  finalUrl: string; status: number; responseMs: number; redirects: Redirect[]; xRobotsTag: string | null;
  home: HomeFacts; headings: HeadingInfo;
  robotsTxt: Presence; robots: RobotsInfo | null;
  sitemap: Presence; sitemapInfo: SitemapInfo | null;
  httpRedirectsToHttps: Presence;
  internalLinkCount: number;
  pages: PageObservation[];
  brokenLinks: BrokenLink[]; sampledLinks: number;
};

export type TechnicalReport = {
  observedAt: string;
  finalUrl: string; status: number; https: boolean;
  redirects: Redirect[];
  canonical: { value: string | null; matchesFinalUrl: boolean | null };
  indexability: { indexable: boolean; reasons: string[] };
  robotsTxt: { presence: Presence; blocksAllCrawlers: boolean | null; sitemapDirectives: string[] };
  sitemap: { presence: Presence; kind: SitemapInfo["kind"] | null; entries: number | null };
  headings: HeadingInfo;
  links: { internalFound: number; sampledChecked: number; broken: BrokenLink[] };
  pages: PageObservation[];
  findings: Finding[];
  score: { value: number; formula: string };
};

// ---- parsing helpers -------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
function plain(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, " ").trim().slice(0, 160);
}
function stripNonContent(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ").replace(/<template\b[\s\S]*?<\/template\s*>/gi, " ");
}

export function extractHeadings(html: string, maxOutline = 40): HeadingInfo {
  const body = stripNonContent(html.slice(0, 600_000));
  const outline: Heading[] = [];
  const counts = { h1: 0, h2: 0, h3: 0 };
  let prev = 0;
  let skipped = false;
  for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const level = Number(m[1]);
    if (level === 1) counts.h1++;
    if (level === 2) counts.h2++;
    if (level === 3) counts.h3++;
    if (prev && level > prev + 1) skipped = true;   // e.g. h1 -> h3
    prev = level;
    const text = plain(m[2]);
    if (outline.length < maxOutline && text) outline.push({ level, text });
  }
  return { ...counts, outline, skippedLevels: skipped };
}

// Only the rules that decide crawlability for ALL crawlers (the "*" group), plus Sitemap lines.
export function parseRobotsTxt(txt: string): RobotsInfo {
  let inStarGroup = false;
  let groupHasAgent = false;
  let blocksAll = false;
  let disallowRules = 0;
  const sitemaps: string[] = [];
  for (const raw of txt.slice(0, 200_000).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!groupHasAgent) inStarGroup = false;           // a new group starts after rules; consecutive agents share rules
      groupHasAgent = true;
      if (value === "*") inStarGroup = true;
    } else if (key === "sitemap") {
      if (/^https?:\/\//i.test(value) && sitemaps.length < 5) sitemaps.push(value.slice(0, 300));
    } else if (key === "disallow" || key === "allow") {
      groupHasAgent = false;
      if (key === "disallow" && value) { disallowRules++; if (inStarGroup && value === "/") blocksAll = true; }
    }
  }
  return { blocksAllCrawlers: blocksAll, sitemapDirectives: sitemaps, disallowRules };
}

export function parseSitemapXml(xml: string): SitemapInfo {
  const head = xml.slice(0, 1_000_000);
  const entries = (head.match(/<loc>/gi) ?? []).length;
  if (/<sitemapindex\b/i.test(head)) return { kind: "index", entries };
  if (/<urlset\b/i.test(head)) return { kind: "urlset", entries };
  return { kind: "unknown", entries };
}

function normUrl(u: string): string | null {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/+$/, "") || "/";
    return `${x.protocol}//${x.hostname.toLowerCase().replace(/^www\./, "")}${path}${x.search}`;
  } catch { return null; }
}

export function xRobotsIsNoindex(v: string | null): boolean {
  return !!v && /\b(noindex|none)\b/i.test(v);
}

// ---- findings --------------------------------------------------------------------------------------------

export function buildTechnicalFindings(i: TechnicalInput): Finding[] {
  const f: Finding[] = [];
  const add = (x: Finding) => f.push(x);
  const h = i.home;
  const https = i.finalUrl.startsWith("https://");

  if (!https) add({ id: "https_missing", severity: "critical", scope: "site", title: "Homepage is not served over HTTPS", evidence: `The homepage ended on ${i.finalUrl}.`, recommendation: "Install a certificate and serve the whole site over https://." });
  if (i.httpRedirectsToHttps === "missing") add({ id: "http_no_redirect", severity: "warning", scope: "site", title: "http:// does not redirect to https://", evidence: "Requesting the http:// address did not end on the secure version.", recommendation: "Add a permanent (301) redirect from http:// to https://." });

  const noindexMeta = h.noindex;
  const noindexHeader = xRobotsIsNoindex(i.xRobotsTag);
  if (noindexMeta || noindexHeader) {
    add({ id: "homepage_noindex", severity: "critical", scope: "site", title: "Homepage asks search engines not to index it",
      evidence: noindexMeta && noindexHeader ? "Both a robots meta tag and an X-Robots-Tag header contain noindex." : noindexMeta ? "A robots meta tag contains noindex." : `The X-Robots-Tag header is "${i.xRobotsTag}".`,
      recommendation: "Remove noindex unless keeping the page out of search results is intentional." });
  }
  if (i.robots?.blocksAllCrawlers) add({ id: "robots_blocks_all", severity: "critical", scope: "site", title: "robots.txt blocks all crawlers", evidence: "The rules for all user agents contain Disallow: /.", recommendation: "Remove the blanket Disallow unless the whole site should stay out of search engines." });
  if (i.robotsTxt === "missing") add({ id: "robots_missing", severity: "notice", scope: "site", title: "No robots.txt file", evidence: "/robots.txt returned not found.", recommendation: "Optional, but a robots.txt lets you declare your sitemap and any areas crawlers should skip." });
  if (i.sitemap === "missing") add({ id: "sitemap_missing", severity: "warning", scope: "site", title: "No XML sitemap at /sitemap.xml", evidence: "/sitemap.xml returned not found.", recommendation: "Publish an XML sitemap and reference it from robots.txt so crawlers can discover your pages." });
  if (i.sitemap === "found" && i.robotsTxt === "found" && i.robots && i.robots.sitemapDirectives.length === 0) add({ id: "sitemap_not_in_robots", severity: "notice", scope: "site", title: "robots.txt does not reference the sitemap", evidence: "A sitemap exists but no Sitemap: line was found in robots.txt.", recommendation: "Add a Sitemap: line with the full sitemap URL." });

  if (i.redirects.length >= 2) add({ id: "redirect_chain", severity: "warning", scope: "site", title: "Homepage goes through a redirect chain", evidence: `${i.redirects.length} redirects before the final page: ${i.redirects.map((r) => `${r.status}`).join(" → ")}.`, recommendation: "Redirect straight to the final address in a single step." });

  const canon = h.canonical;
  if (!canon) add({ id: "canonical_missing", severity: "warning", scope: "site", title: "Homepage has no canonical URL", evidence: "No rel=canonical link was found in the page head.", recommendation: "Add a self-referencing canonical link so duplicate addresses resolve to one version." });
  else {
    const a = normUrl(canon), b = normUrl(i.finalUrl);
    if (a && b && a !== b) add({ id: "canonical_mismatch", severity: "warning", scope: "site", title: "Canonical URL differs from the homepage address", evidence: `Canonical: ${canon}. Final address: ${i.finalUrl}.`, recommendation: "Confirm the canonical is intended; otherwise point it at the address you want indexed." });
  }

  if (!h.title) add({ id: "title_missing", severity: "critical", scope: "site", title: "Homepage has no title", evidence: "No <title> element was found.", recommendation: "Add a descriptive title of roughly 15 to 65 characters." });
  else if (h.title.length < 15 || h.title.length > 65) add({ id: "title_length", severity: "notice", scope: "site", title: "Homepage title length", evidence: `The title is ${h.title.length} characters.`, recommendation: "Around 15 to 65 characters usually displays fully." });
  if (!h.metaDescription) add({ id: "meta_description_missing", severity: "warning", scope: "site", title: "Homepage has no meta description", evidence: "No meta description was found.", recommendation: "Add a summary of roughly 70 to 170 characters." });
  else if (h.metaDescription.length < 70 || h.metaDescription.length > 170) add({ id: "meta_description_length", severity: "notice", scope: "site", title: "Meta description length", evidence: `The description is ${h.metaDescription.length} characters.`, recommendation: "Roughly 70 to 170 characters tends to read well." });

  if (i.headings.h1 === 0) add({ id: "h1_missing", severity: "warning", scope: "site", title: "Homepage has no H1", evidence: "No <h1> element was found.", recommendation: "Add one main heading that describes the page." });
  else if (i.headings.h1 > 1) add({ id: "h1_multiple", severity: "notice", scope: "site", title: "Homepage has several H1 headings", evidence: `${i.headings.h1} H1 elements were found.`, recommendation: "One H1 per page is the usual convention." });
  if (i.headings.skippedLevels) add({ id: "heading_skip", severity: "notice", scope: "site", title: "Heading levels are skipped", evidence: "The outline jumps more than one level (for example H1 to H3).", recommendation: "Use headings in order so the structure reads as an outline." });

  if (!h.hasViewport) add({ id: "viewport_missing", severity: "warning", scope: "site", title: "No mobile viewport setting", evidence: "No meta viewport tag was found.", recommendation: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." });
  if (!h.lang) add({ id: "lang_missing", severity: "notice", scope: "site", title: "No page language", evidence: "The <html> element has no lang attribute.", recommendation: "Declare the language, for example <html lang=\"en\">." });
  if (h.imageCount > 0 && h.imagesMissingAlt > 0) add({ id: "images_alt", severity: "notice", scope: "site", title: "Images without alt text", evidence: `${h.imagesMissingAlt} of ${h.imageCount} homepage images have no alt text.`, recommendation: "Describe meaningful images; it also helps accessibility." });
  if (i.responseMs > 2500) add({ id: "slow_response", severity: "warning", scope: "site", title: "Slow homepage response", evidence: `One request from our server took about ${(i.responseMs / 1000).toFixed(1)}s (not a full speed test).`, recommendation: "Check hosting, caching and server response time." });
  if (i.internalLinkCount === 0) add({ id: "no_internal_links", severity: "warning", scope: "site", title: "No crawlable internal links on the homepage", evidence: "No same-site <a href> links were found in the served HTML.", recommendation: "Make sure navigation uses real links; pages reachable only through scripts may not be discovered." });

  if (i.brokenLinks.length > 0) {
    add({ id: "broken_internal_links", severity: "warning", scope: "site", title: "Broken internal links in the sample",
      evidence: `${i.brokenLinks.length} of ${i.sampledLinks} sampled internal links failed: ${i.brokenLinks.slice(0, 3).map((b) => `${b.url} (${b.status ?? "no response"})`).join("; ")}.`,
      recommendation: "Fix or remove the links, or redirect the old address. This is a sample, not a full crawl." });
  }

  // Page-level findings for the sample of pages we read.
  const titles = new Map<string, string[]>();
  for (const p of i.pages) {
    if (p.status != null && p.status >= 500) add({ id: "page_server_error", severity: "critical", scope: "page", url: p.url, title: "Page returns a server error", evidence: `HTTP ${p.status}.`, recommendation: "Fix the server error or remove the page from the sitemap and links." });
    else if (p.status != null && p.status >= 400) add({ id: "page_client_error", severity: "warning", scope: "page", url: p.url, title: "Page returns an error status", evidence: `HTTP ${p.status}.`, recommendation: "Restore the page, redirect it, or remove links and sitemap entries that point to it." });
    else if (p.status === null) add({ id: "page_unreachable", severity: "warning", scope: "page", url: p.url, title: "Page could not be fetched", evidence: "No response was received (timeout, connection problem or blocked).", recommendation: "Check the page loads reliably." });
    if (p.status === 200) {
      if (!p.title) add({ id: "page_title_missing", severity: "warning", scope: "page", url: p.url, title: "Page has no title", evidence: "No <title> element.", recommendation: "Add a unique descriptive title." });
      else titles.set(p.title.toLowerCase(), [...(titles.get(p.title.toLowerCase()) ?? []), p.url]);
      if (p.metaDescription === null) add({ id: "page_meta_missing", severity: "notice", scope: "page", url: p.url, title: "Page has no meta description", evidence: "No meta description.", recommendation: "Add a short summary." });
      if (p.h1Count === 0) add({ id: "page_h1_missing", severity: "notice", scope: "page", url: p.url, title: "Page has no H1", evidence: "No <h1> element.", recommendation: "Add one main heading." });
      if (p.noindex) add({ id: "page_noindex", severity: "notice", scope: "page", url: p.url, title: "Page is set to noindex", evidence: "A robots meta tag contains noindex.", recommendation: "Fine if intentional; otherwise remove it." });
    }
  }
  for (const [title, urls] of titles) {
    if (urls.length > 1) add({ id: "duplicate_titles", severity: "warning", scope: "page", url: urls[0], title: "Several pages share the same title", evidence: `"${title.slice(0, 80)}" is used on ${urls.length} sampled pages.`, recommendation: "Give each page a unique title." });
  }
  return f;
}

// ---- score -----------------------------------------------------------------------------------------------

export const TECHNICAL_SCORE_FORMULA =
  "100 minus 15 per critical finding, 6 per warning and 1.5 per notice, never below 0. A page-level finding type is counted at most 3 times so one repeated issue cannot dominate. This is PostAtlas's own score from the checks on this page. It is not Domain Rating, Domain Authority or any third-party metric.";
const WEIGHT: Record<Severity, number> = { critical: 15, warning: 6, notice: 1.5 };

export function computeTechnicalScore(findings: Finding[]): number {
  const seenPage = new Map<string, number>();
  let deduction = 0;
  for (const x of findings) {
    if (x.scope === "page") {
      const n = (seenPage.get(x.id) ?? 0) + 1;
      seenPage.set(x.id, n);
      if (n > 3) continue;
    }
    deduction += WEIGHT[x.severity];
  }
  return Math.max(0, Math.round(100 - deduction));
}

export function assembleTechnicalReport(i: TechnicalInput, observedAt: string): TechnicalReport {
  const findings = buildTechnicalFindings(i);
  const noindexMeta = i.home.noindex;
  const noindexHeader = xRobotsIsNoindex(i.xRobotsTag);
  const reasons: string[] = [];
  if (noindexMeta) reasons.push("robots meta tag contains noindex");
  if (noindexHeader) reasons.push("X-Robots-Tag header contains noindex");
  if (i.robots?.blocksAllCrawlers) reasons.push("robots.txt blocks all crawlers");
  const a = i.home.canonical ? normUrl(i.home.canonical) : null;
  const b = normUrl(i.finalUrl);
  return {
    observedAt, finalUrl: i.finalUrl, status: i.status, https: i.finalUrl.startsWith("https://"), redirects: i.redirects.slice(0, 5),
    canonical: { value: i.home.canonical, matchesFinalUrl: a && b ? a === b : null },
    indexability: { indexable: reasons.length === 0, reasons },
    robotsTxt: { presence: i.robotsTxt, blocksAllCrawlers: i.robots ? i.robots.blocksAllCrawlers : null, sitemapDirectives: i.robots?.sitemapDirectives ?? [] },
    sitemap: { presence: i.sitemap, kind: i.sitemapInfo?.kind ?? null, entries: i.sitemapInfo ? i.sitemapInfo.entries : null },
    headings: i.headings,
    links: { internalFound: i.internalLinkCount, sampledChecked: i.sampledLinks, broken: i.brokenLinks.slice(0, 20) },
    pages: i.pages.slice(0, 10),
    findings: findings.slice(0, 80),
    score: { value: computeTechnicalScore(findings), formula: TECHNICAL_SCORE_FORMULA }
  };
}

// Observation of one fetched page (used for the page-level sample).
export function observePage(url: string, status: number | null, html: string | null): PageObservation {
  if (status !== 200 || html == null) return { url, status, title: null, metaDescription: null, h1Count: null, canonical: null, noindex: null, internalLinks: null };
  const sig = extractPageSignals(html, url);
  const head = html.slice(0, 300_000);
  const titleM = head.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleM ? plain(titleM[1]) || null : null;
  let metaDescription: string | null = null;
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\bname\s*=\s*["']?description["']?/i.test(tag)) { const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i); metaDescription = c ? (c[1] ?? c[2] ?? "").trim().slice(0, 300) : ""; break; }
  }
  const h1Count = (stripNonContent(html.slice(0, 600_000)).match(/<h1\b/gi) ?? []).length;
  return { url, status, title, metaDescription: metaDescription === "" ? null : metaDescription, h1Count, canonical: sig.canonical, noindex: sig.noindex, internalLinks: null };
}
