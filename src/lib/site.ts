import { resolveSiteUrl, indexingAllowed as allowed } from "./site-env.ts";

// The canonical origin used in sitemaps, robots, canonical links and emails (rules: src/lib/site-env.ts).
export function siteUrl(): string {
  return resolveSiteUrl(process.env);
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** False on localhost and on *.vercel.app test/preview hosts (unless ALLOW_INDEXING=true): those must never be indexed. */
export function indexingAllowed(): boolean {
  return allowed(process.env);
}
