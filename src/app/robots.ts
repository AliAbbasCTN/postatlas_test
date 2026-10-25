import type { MetadataRoute } from "next";
import { siteUrl, indexingAllowed } from "@/lib/site";

// Production: crawl the public site, keep private application areas out, point to the sitemap.
// Test / preview / local hosts (*.vercel.app, localhost): block everything and publish no sitemap, so a test deployment can never be
// indexed or compete with the production domain. Set ALLOW_INDEXING=true only if you really want such a host indexed.
//
// The sign-in and account-recovery pages are deliberately NOT disallowed here: they carry `noindex` (meta + X-Robots-Tag header), and a
// crawler can only honour a noindex it is allowed to fetch. Disallow + noindex would leave a bare URL indexable.
export default function robots(): MetadataRoute.Robots {
  if (!indexingAllowed()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/dashboard", "/publisher", "/api/", "/auth/"] }],
    sitemap: `${base}/sitemap.xml`
  };
}
