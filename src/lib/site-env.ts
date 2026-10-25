// Pure environment rules for the canonical origin and for search-engine indexing. No imports, so tests can run it directly.
// Rules (documented in docs/seo/DEPLOYMENT_SEO.md):
//  * SITE_URL always wins. It must be the ONE canonical origin of the environment (no trailing slash).
//  * On a Vercel PREVIEW deployment without SITE_URL, the deployment's own URL is used, so canonicals and sitemaps never point at production.
//  * Production without SITE_URL is a configuration error and fails loudly instead of emitting localhost URLs.
//  * Indexing is allowed only on a real domain. localhost and *.vercel.app hosts (test and preview deployments) are never indexed unless
//    ALLOW_INDEXING=true is set on purpose, so a test deployment cannot compete with the production domain.
export type Env = Record<string, string | undefined>;

export function resolveSiteUrl(env: Env): string {
  const raw = env.SITE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL.replace(/\/+$/, "")}`;
  if (env.NODE_ENV === "production") throw new Error("SITE_URL must be set in production (e.g. https://postatlas.example).");
  return "http://localhost:3000";
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

export function indexingAllowed(env: Env): boolean {
  if (env.ALLOW_INDEXING === "true") return true;
  if (env.ALLOW_INDEXING === "false") return false;
  let host = "";
  try { host = hostOf(resolveSiteUrl(env)); } catch { return false; }
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".vercel.app")) return false;
  return true;
}
