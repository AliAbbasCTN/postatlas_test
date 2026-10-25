import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import type { RequestOptions } from "node:https";
import { isIP } from "node:net";
import { validatePublicHttpUrl, isBlockedIp } from "./url-safety.ts";
import type { FetchOutcome } from "./placement-eval.ts";

// The only function in PostAtlas that fetches a user-influenced URL.
//  - validates scheme / port / credentials / internal hostnames up front
//  - resolves DNS itself, refuses private / loopback / metadata addresses
//  - pins the connection to the address it validated (defeats DNS rebinding)
//  - follows at most 3 redirects, re-validating every hop
//  - hard timeout, hard response-size cap, no compression, no cookies
// Node runtime only (never import this from client code or the edge runtime).

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 8000,
  maxBytes: 1_500_000,
  maxRedirects: 3,
  userAgent: "PostAtlasBot/1.0 (placement verification)"
};

type Opts = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** Content types accepted for 2xx responses. */
  allowedTypes?: RegExp;
};

type Hop =
  | { kind: "response"; status: number; headers: IncomingHttpHeaders; body: string }
  | { kind: "error"; reason: Extract<FetchOutcome, { kind: "unreachable" }>["reason"] };

async function resolvePinned(host: string): Promise<{ address: string; family: 4 | 6 } | "dns" | "blocked"> {
  const bare = host.replace(/^\[|\]$/g, "");
  const ipFamily = isIP(bare);
  if (ipFamily) return isBlockedIp(bare) ? "blocked" : { address: bare, family: ipFamily as 4 | 6 };
  let records: { address: string; family: number }[];
  try { records = await dnsLookup(bare, { all: true, verbatim: true }); } catch { return "dns"; }
  if (records.length === 0) return "dns";
  // Refuse if ANY record is internal: a hostname must never mix public and private answers.
  if (records.some((r) => isBlockedIp(r.address))) return "blocked";
  return { address: records[0].address, family: records[0].family as 4 | 6 };
}

function requestOnce(url: URL, pin: { address: string; family: 4 | 6 }, o: Required<Pick<Opts, "timeoutMs" | "maxBytes">> & Opts): Promise<Hop> {
  return new Promise((resolve) => {
    const mod = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (h: Hop) => { if (!settled) { settled = true; clearTimeout(timer); resolve(h); } };
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        agent: false,
        headers: {
          "User-Agent": SAFE_FETCH_DEFAULTS.userAgent,
          Accept: o.accept ?? "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity"
        },
        // Pin to the address we already validated.
        lookup: (_h: string, options: unknown, cb: (...a: unknown[]) => void) => {
          if (options && typeof options === "object" && (options as { all?: boolean }).all) cb(null, [{ address: pin.address, family: pin.family }]);
          else cb(null, pin.address, pin.family);
        }
      } as RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        const isRedirect = [301, 302, 303, 307, 308].includes(status);
        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        const allowed = o.allowedTypes ?? /(text\/html|application\/xhtml\+xml)/;
        if (!isRedirect && status >= 200 && status < 300 && type && !allowed.test(type)) {
          res.destroy();
          return done({ kind: "error", reason: "not_html" });
        }
        // Error pages: we only need the status code, not the body.
        if (!isRedirect && (status < 200 || status >= 300)) {
          res.destroy();
          return done({ kind: "response", status, headers: res.headers, body: "" });
        }
        if (isRedirect) {
          res.destroy();
          return done({ kind: "response", status, headers: res.headers, body: "" });
        }
        // Collect as text (setEncoding handles multi-byte characters split across chunks) and count real bytes.
        res.setEncoding("utf8");
        let body = "";
        let size = 0;
        res.on("data", (c: string) => {
          size += Buffer.byteLength(c, "utf8");
          if (size > o.maxBytes) { res.destroy(); done({ kind: "error", reason: "too_large" }); return; }
          body += c;
        });
        res.on("end", () => done({ kind: "response", status, headers: res.headers, body }));
        res.on("error", () => done({ kind: "error", reason: "connection" }));
      }
    );
    const timer = setTimeout(() => { req.destroy(); done({ kind: "error", reason: "timeout" }); }, o.timeoutMs);
    req.on("error", () => done({ kind: "error", reason: "connection" }));
    req.end();
  });
}

export async function safeFetch(startUrl: string, opts: Opts = {}): Promise<FetchOutcome> {
  const timeoutMs = opts.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const started = Date.now();
  let current = startUrl;
  const redirects: { from: string; to: string; status: number }[] = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = validatePublicHttpUrl(current);
    if (!check.ok) return { kind: "unreachable", reason: "blocked" };
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return { kind: "unreachable", reason: "timeout" };

    const pin = await resolvePinned(check.url.hostname);
    if (pin === "dns") return { kind: "unreachable", reason: "dns" };
    if (pin === "blocked") return { kind: "unreachable", reason: "blocked" };

    const r = await requestOnce(check.url, pin, { ...opts, timeoutMs: remaining, maxBytes });
    if (r.kind === "error") return { kind: "unreachable", reason: r.reason };

    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.location;
      if (!loc) return { kind: "unreachable", reason: "connection" };
      let next: string;
      try { next = new URL(loc, current).toString(); } catch { return { kind: "unreachable", reason: "blocked" }; }
      redirects.push({ from: current, to: next, status: r.status });
      current = next;
      continue;
    }
    const header = (name: string) => { const v = r.headers[name]; return Array.isArray(v) ? v.join(", ").slice(0, 300) : typeof v === "string" ? v.slice(0, 300) : null; };
    return {
      kind: "ok", status: r.status, finalUrl: current, html: r.body, responseMs: Date.now() - started,
      redirects, headers: { xRobotsTag: header("x-robots-tag"), contentType: header("content-type") }
    };
  }
  return { kind: "unreachable", reason: "too_many_redirects" };
}
