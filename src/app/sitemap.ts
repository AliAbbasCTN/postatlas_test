import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
import { NICHES } from "@/lib/niches";
import { slugifyNiche } from "@/lib/seo";

export const revalidate = 3600;

// Only public, indexable, canonical URLs. No query strings, no private areas. A sitemap index would be needed
// above 50,000 URLs; publishers are fetched in pages so memory stays bounded either way.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entries: MetadataRoute.Sitemap = ["", "/check", "/publishers", "/how-it-works", "/pricing", "/blog", "/write-for-us", "/about", "/contact", "/privacy", "/terms", "/refund-policy"]
    .map((p) => ({ url: `${base}${p}`, changeFrequency: p === "" ? "weekly" : "monthly", priority: p === "" ? 1 : 0.6 }));
  try {
    const db = createPublicClient();
    const niches = new Map<string, number>();
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await db.from("publisher_websites").select("domain, niche, created_at").eq("status", "approved").order("domain").range(from, from + 999);
      if (error || !data?.length) break;
      for (const w of data) {
        entries.push({ url: `${base}/publishers/${encodeURIComponent(w.domain)}`, lastModified: new Date(w.created_at), changeFrequency: "monthly", priority: 0.7 });
        if (w.niche) niches.set(w.niche, (niches.get(w.niche) ?? 0) + 1);
      }
      if (data.length < 1000) break;
    }
    for (const n of NICHES) if ((niches.get(n) ?? 0) >= 3) entries.push({ url: `${base}/publishers/category/${slugifyNiche(n)}`, changeFrequency: "weekly", priority: 0.65 });
    const { data: posts } = await db.from("articles").select("slug, updated_at").eq("status", "PUBLISHED").order("published_at", { ascending: false }).limit(5000);
    for (const p of posts ?? []) entries.push({ url: `${base}/blog/${encodeURIComponent(p.slug)}`, lastModified: new Date(p.updated_at), changeFrequency: "monthly", priority: 0.6 });
  } catch (e) {
    console.error("[sitemap]", e instanceof Error ? e.message : "unknown");
  }
  return entries;
}
