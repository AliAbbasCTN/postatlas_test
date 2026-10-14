// Pure helpers for the public "check your website" report. Everything here describes what a fetch OBSERVED
// about a page; nothing is estimated and nothing claims how a search engine will treat the page.

import { extractPageSignals } from "./link-check.ts";

export type HomeFacts = {
  finalUrl: string;
  status: number;
  responseMs: number;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  hasViewport: boolean;
  lang: string | null;
  noindex: boolean;
  canonical: string | null;
  imageCount: number;
  imagesMissingAlt: number;
};

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2] ?? "") : null;
}

export function extractHomeFacts(html: string, finalUrl: string, status: number, responseMs: number): HomeFacts {
  const head = html.slice(0, 300_000);
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || null : null;

  let metaDescription: string | null = null;
  let hasViewport = false;
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, "name") ?? "").toLowerCase();
    if (name === "description" && metaDescription === null) metaDescription = (attr(tag, "content") ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || null;
    if (name === "viewport") hasViewport = true;
  }
  const body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ");
  const h1Count = (body.match(/<h1\b/gi) ?? []).length;
  const langMatch = head.match(/<html\b[^>]*\blang\s*=\s*["']?([A-Za-z-]{2,10})/i);
  const imgs = body.match(/<img\b[^>]*>/gi) ?? [];
  const imagesMissingAlt = imgs.filter((t) => { const a = attr(t, "alt"); return a === null || a.trim() === ""; }).length;
  const signals = extractPageSignals(html, finalUrl);
  return {
    finalUrl, status, responseMs, title, metaDescription, h1Count, hasViewport, lang: langMatch ? langMatch[1] : null,
    noindex: signals.noindex, canonical: signals.canonical, imageCount: imgs.length, imagesMissingAlt
  };
}

export type Presence = "found" | "missing" | "unknown";

export type RawSiteCheck = {
  home: HomeFacts | null;
  unreachableReason: string | null;
  robotsTxt: Presence;
  sitemap: Presence;
  httpRedirectsToHttps: Presence;     // does http:// end up on https://
  pages: { url: string; status: number | null; title: string | null; noindex: boolean | null }[];
};

export type CheckState = "good" | "improve" | "info";
export type CheckItem = { id: string; label: string; state: CheckState; detail: string };

// Turns raw observations into a friendly checklist. Wording is neutral and factual: it says what we saw and
// why it can matter, and never promises a ranking effect.
export function buildChecklist(raw: RawSiteCheck): CheckItem[] {
  const out: CheckItem[] = [];
  const h = raw.home;
  if (!h) return out;
  const https = h.finalUrl.startsWith("https://");
  out.push(https
    ? { id: "https", label: "Secure connection (HTTPS)", state: "good", detail: "Your site loads over HTTPS." }
    : { id: "https", label: "Secure connection (HTTPS)", state: "improve", detail: "Your homepage did not end up on an https:// address. Browsers warn visitors about sites without HTTPS." });
  if (raw.httpRedirectsToHttps === "missing") out.push({ id: "redirect", label: "Old http:// address redirects to https://", state: "improve", detail: "Visiting the http:// version did not take us to the secure version." });
  else if (raw.httpRedirectsToHttps === "found") out.push({ id: "redirect", label: "Old http:// address redirects to https://", state: "good", detail: "The http:// version sends visitors to the secure one." });

  out.push(h.responseMs <= 2500
    ? { id: "speed", label: "Homepage responded promptly", state: "good", detail: `Our request was answered in about ${(h.responseMs / 1000).toFixed(1)}s (one request from our server, not a full speed test).` }
    : { id: "speed", label: "Homepage responded promptly", state: "improve", detail: `Our request took about ${(h.responseMs / 1000).toFixed(1)}s. Slow responses can frustrate visitors.` });

  if (!h.title) out.push({ id: "title", label: "Page title", state: "improve", detail: "The homepage has no title. The title is the headline people see in search results and browser tabs." });
  else if (h.title.length < 15 || h.title.length > 65) out.push({ id: "title", label: "Page title", state: "improve", detail: `The title is ${h.title.length} characters. Around 15 to 65 usually displays fully and describes the page well.` });
  else out.push({ id: "title", label: "Page title", state: "good", detail: `"${h.title}"` });

  if (!h.metaDescription) out.push({ id: "description", label: "Meta description", state: "improve", detail: "No description was found. It is the short summary that can appear under your title in search results." });
  else if (h.metaDescription.length < 70 || h.metaDescription.length > 170) out.push({ id: "description", label: "Meta description", state: "improve", detail: `The description is ${h.metaDescription.length} characters. Roughly 70 to 170 tends to read well.` });
  else out.push({ id: "description", label: "Meta description", state: "good", detail: "A description of a sensible length is present." });

  if (h.h1Count === 1) out.push({ id: "h1", label: "One main heading (H1)", state: "good", detail: "The homepage has a single main heading." });
  else if (h.h1Count === 0) out.push({ id: "h1", label: "One main heading (H1)", state: "improve", detail: "No main heading (H1) was found on the homepage." });
  else out.push({ id: "h1", label: "One main heading (H1)", state: "info", detail: `The homepage has ${h.h1Count} main headings. One is the usual convention.` });

  out.push(h.hasViewport
    ? { id: "mobile", label: "Mobile-friendly setup", state: "good", detail: "A mobile viewport setting is present." }
    : { id: "mobile", label: "Mobile-friendly setup", state: "improve", detail: "No mobile viewport setting was found, so the page may not display well on phones." });

  out.push(h.noindex
    ? { id: "noindex", label: "Open to search engines", state: "improve", detail: "The homepage asks search engines NOT to index it (a noindex directive). That is only right if it is intentional." }
    : { id: "noindex", label: "Open to search engines", state: "good", detail: "No noindex directive was found on the homepage." });

  if (raw.robotsTxt !== "unknown") out.push({ id: "robots", label: "robots.txt", state: raw.robotsTxt === "found" ? "good" : "info", detail: raw.robotsTxt === "found" ? "A robots.txt file is present." : "No robots.txt file was found. It is optional, but common." });
  if (raw.sitemap !== "unknown") out.push({ id: "sitemap", label: "XML sitemap", state: raw.sitemap === "found" ? "good" : "improve", detail: raw.sitemap === "found" ? "A sitemap.xml file is present." : "No sitemap.xml was found at the usual address. A sitemap helps search engines discover your pages." });

  if (h.imageCount > 0) out.push(h.imagesMissingAlt === 0
    ? { id: "alt", label: "Image descriptions (alt text)", state: "good", detail: "Every image on the homepage has alt text." }
    : { id: "alt", label: "Image descriptions (alt text)", state: "improve", detail: `${h.imagesMissingAlt} of ${h.imageCount} homepage images have no alt text, which also helps accessibility.` });
  return out;
}

export function summarize(items: CheckItem[]) {
  const good = items.filter((i) => i.state === "good").length;
  const improve = items.filter((i) => i.state === "improve").length;
  return { good, improve, total: items.length };
}
