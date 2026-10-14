// The canonical origin used in sitemaps, robots, canonical links and emails.
// In production SITE_URL must be set; we never fall back to localhost there.
export function siteUrl(): string {
  const raw = process.env.SITE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("SITE_URL must be set in production (e.g. https://postatlas.example).");
  }
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
