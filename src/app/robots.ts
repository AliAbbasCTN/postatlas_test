import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/dashboard", "/publisher", "/api/", "/auth/", "/login", "/signup", "/reset-password", "/update-password", "/apply-publisher"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base
  };
}
