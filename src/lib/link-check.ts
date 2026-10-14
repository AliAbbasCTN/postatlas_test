
 // Pure HTML link inspection used by placement verification and monitoring.
 // No network access here - safe-fetch.ts supplies the HTML.

export type AnchorInfo = { href: string; resolvedHref: string; text: string; rel: string[] };

const MAX_ANCHORS = 5000;
const MAX_HTML_LENGTH = 2_000_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      if (!Number.isFinite(code) || code > 0x10ffff) return "\uFFFD";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "\uFFFD";
      }
    });
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<a\b/i, "").replace(/\/?>$/, "");
  let m: RegExpExecArray | null;

  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) {
      attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
  }

  return attrs;
}

export function extractBaseHref(html: string, pageUrl: string): string {
  // Keep this scan bounded, just like the other HTML inspections.
  const head = html.slice(0, MAX_HTML_LENGTH);
  const m = head.match(/<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!m) return pageUrl;

  try {
    return new URL(decodeEntities(m[1] ?? m[2] ?? ""), pageUrl).toString();
  } catch {
    return pageUrl;
  }
}

export function extractAnchors(html: string, pageUrl: string): AnchorInfo[] {
  // Avoid unbounded work on unexpectedly large publisher responses.
  const input = html.slice(0, MAX_HTML_LENGTH);

  // Strip comments, scripts and styles so links inside them are not counted.
  const clean = input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ");

  const base = extractBaseHref(clean, pageUrl);
  const out: AnchorInfo[] = [];
  const openingTag = /<a\b/gi;
  const closingTag = /<\/a\s*>/gi;
  let searchFrom = 0;

  while (out.length < MAX_ANCHORS && searchFrom < clean.length) {
    openingTag.lastIndex = searchFrom;
    const start = openingTag.exec(clean);
    if (!start) break;

    const tagStart = start.index;
    let tagEnd = tagStart + start[0].length;
    let quote = "";

    // Find the end of the opening tag without treating a quoted ">" as
    // the tag boundary.
    for (; tagEnd < clean.length; tagEnd++) {
      const ch = clean[tagEnd];

      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
    }

    // A broken, unterminated tag has no usable href.
    if (tagEnd >= clean.length) break;

    const openTag = clean.slice(tagStart, tagEnd + 1);

    // Find this anchor's closing tag.
    closingTag.lastIndex = tagEnd + 1;
    const close = closingTag.exec(clean);

    if (!close) {
      // Recover after the opening tag rather than repeatedly scanning it.
      searchFrom = tagEnd + 1;
      continue;
    }

    const attrs = parseAttrs(openTag);

    if (attrs.href?.trim()) {
      const href = attrs.href.trim();

      try {
        const resolvedHref = new URL(href, base).toString();
        const inner = clean.slice(tagEnd + 1, close.index);

        out.push({
          href,
          resolvedHref,
          text: decodeEntities(inner.replace(/<[^>]*>/g, " "))
            .replace(/\s+/g, " ")
            .trim(),
          rel: (attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean)
        });
      } catch {
        // Ignore invalid URLs; do not fail the entire page inspection.
      }
    }

    searchFrom = close.index + close[0].length;
  }

  return out;
}

// Comparison form of a URL: lowercase host without www, no hash, no trailing
// slash on the path, tracking parameters dropped. Query string otherwise kept.
export function normalizeForCompare(u: string): string | null {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...url.searchParams.entries()]
      .filter(([k]) => !/^(utm_[a-z]+|gclid|fbclid|ref)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length
      ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
      : "";
    const path = url.pathname.replace(/\/+$/, "") || "";
    return `${host}${path}${qs}`;
  } catch {
    return null;
  }
}

export type LinkAttribute = "dofollow" | "nofollow" | "sponsored" | "ugc";

export function linkAttributeFromRel(rel: string[]): LinkAttribute {
  if (rel.includes("nofollow")) return "nofollow";
  if (rel.includes("sponsored")) return "sponsored";
  if (rel.includes("ugc")) return "ugc";
  return "dofollow";
}

export type PageSignals = {
  noindex: boolean;
  nofollowAll: boolean;
  canonical: string | null;
};

// Page-level directives that can neutralise a link even when the anchor looks fine.
export function extractPageSignals(html: string, pageUrl: string): PageSignals {
  const head = html.slice(0, 200_000);
  let noindex = false;
  let nofollowAll = false;

  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metas) {
    const name = /\bname\s*=\s*["']?(robots|googlebot)["']?/i.test(tag);
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);

    if (name && content) {
      const value = (content[1] ?? content[2] ?? "").toLowerCase();
      if (/\bnoindex\b|\bnone\b/.test(value)) noindex = true;
      if (/\bnofollow\b|\bnone\b/.test(value)) nofollowAll = true;
    }
  }

  let canonical: string | null = null;

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["']?canonical["']?/i.test(tag)) {
      const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);

      if (href) {
        try {
          canonical = new URL(
            decodeEntities(href[1] ?? href[2] ?? ""),
            pageUrl
          ).toString();
        } catch {
          // Ignore malformed canonical URLs.
        }
      }

      break;
    }
  }

  return { noindex, nofollowAll, canonical };
}

export type LinkFinding = {
  found: boolean;
  attribute: LinkAttribute | null;
  anchorText: string | null;
  anchorMatched: boolean | null;
  matchedHref: string | null;
  otherLinksToTargetDomain: number;
};

export function findLink(
  html: string,
  pageUrl: string,
  expectedTarget: string,
  expectedAnchor?: string | null
): LinkFinding {
  const want = normalizeForCompare(expectedTarget);
  const wantHost = want ? want.split(/[/?]/)[0] : null;
  const anchors = extractAnchors(html, pageUrl);

  const exact = anchors.filter(
    (anchor) => normalizeForCompare(anchor.resolvedHref) === want
  );

  const sameDomain = anchors.filter((anchor) => {
    const normalized = normalizeForCompare(anchor.resolvedHref);
    return Boolean(
      normalized &&
      wantHost &&
      normalized.split(/[/?]/)[0] === wantHost
    );
  });

  if (!want || exact.length === 0) {
    return {
      found: false,
      attribute: null,
      anchorText: null,
      anchorMatched: null,
      matchedHref: null,
      otherLinksToTargetDomain: sameDomain.length
    };
  }

  const wantText = expectedAnchor?.trim().toLowerCase();
  const best =
    (wantText && exact.find((anchor) => anchor.text.toLowerCase() === wantText)) ||
    exact[0];

  return {
    found: true,
    attribute: linkAttributeFromRel(best.rel),
    anchorText: best.text || null,
    anchorMatched: wantText ? best.text.toLowerCase() === wantText : null,
    matchedHref: best.resolvedHref,
    otherLinksToTargetDomain: sameDomain.length - exact.length
  };
}

export function extractTitle(html: string): string | null {
  const m = html.slice(0, 200_000).match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!m) return null;

  const title = decodeEntities(m[1].replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  return title ? title.slice(0, 200) : null;
}

// Same-site internal links found on a page (absolute URLs, fragments removed).
export function extractInternalLinks(
  html: string,
  pageUrl: string,
  host: string,
  max = 50
): string[] {
  const bare = host.toLowerCase().replace(/^www\./, "");
  const out = new Set<string>();

  for (const anchor of extractAnchors(html, pageUrl)) {
    try {
      const url = new URL(anchor.resolvedHref);

      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (url.hostname.toLowerCase().replace(/^www\./, "") !== bare) continue;
      if (/\.(jpe?g|png|gif|svg|webp|pdf|zip|css|js|xml|ico|mp4)$/i.test(url.pathname)) continue;

      url.hash = "";
      out.add(url.toString());

      if (out.size >= max) break;
    } catch {
      // Ignore malformed URLs.
    }
  }

  return [...out];
}