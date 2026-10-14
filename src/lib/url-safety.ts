// Pure URL / IP safety helpers (no I/O) so they can be unit tested. The
// network-facing code in safe-fetch.ts relies on these.

export function parseIPv4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

// Expands an IPv6 literal into 8 16-bit groups, or null if malformed.
export function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (s.includes(".")) {
    // trailing IPv4 part (e.g. ::ffff:127.0.0.1)
    const idx = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(idx + 1));
    if (!v4) return null;
    s = s.slice(0, idx + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

export function isBlockedIPv4(p: number[]): boolean {
  const [a, b, c] = p;
  if (a === 0) return true;                       // "this" network
  if (a === 10) return true;                      // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;  // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;   // TEST-NET-3
  if (a >= 224) return true;                      // multicast, reserved, broadcast
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);
  const g = parseIPv6(ip);
  if (!g) return true; // unparseable -> refuse
  if (g.every((x) => x === 0)) return true;                       // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true;                    // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                    // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;                    // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;            // documentation
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible / NAT64 embeddings
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isBlockedIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  }
  if (g[0] === 0x0064 && g[1] === 0xff9b) {
    return isBlockedIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  }
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".arpa"];

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

// Synchronous, DNS-free checks: scheme, credentials, port, obvious internal
// names and literal IPs. DNS results are re-checked at connect time.
export function validatePublicHttpUrl(
  input: string,
  opts: { requireHttps?: boolean; maxLength?: number } = {}
): UrlCheck {
  const raw = input.trim();
  if (!raw || raw.length > (opts.maxLength ?? 2048)) return { ok: false, reason: "URL is empty or too long." };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "That is not a valid URL." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only http and https URLs are allowed." };
  if (opts.requireHttps && url.protocol !== "https:") return { ok: false, reason: "Please use an https:// URL." };
  if (url.username || url.password) return { ok: false, reason: "URLs containing credentials are not allowed." };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (![80, 443, 8080, 8443].includes(port)) return { ok: false, reason: "That port is not allowed." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, reason: "URL has no hostname." };
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "Internal hostnames are not allowed." };
  const looksIp = parseIPv4(host) || host.includes(":");
  if (looksIp) {
    if (isBlockedIp(host)) return { ok: false, reason: "That address is not allowed." };
  } else {
    if (!host.includes(".")) return { ok: false, reason: "Please enter a full domain name." };
    // Decimal / hex / octal IPv4 forms such as 2130706433 or 0x7f.1 are normalised by
    // new URL(), so they arrive here as dotted quads and are handled above.
  }
  return { ok: true, url };
}

export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  const check = validatePublicHttpUrl(candidate);
  if (!check.ok) return null;
  const host = check.url.hostname.replace(/^www\./, "");
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

// Only same-site, relative-or-absolute internal path used for post-login redirects.
export function safeRedirectPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n\t\\]/.test(next) || next.length > 300) return fallback;
  return next;
}
