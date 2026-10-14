import type { Metadata } from "next";
import { absoluteUrl } from "./site";

export const SITE_NAME = "PostAtlas";

export function pageMeta(o: { title: string; description: string; path: string; noindex?: boolean; type?: "website" | "article" }): Metadata {
  const url = absoluteUrl(o.path);
  return {
    title: o.title,
    description: o.description,
    alternates: { canonical: url },
    robots: o.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title: o.title, description: o.description, url, siteName: SITE_NAME, type: o.type ?? "website" },
    twitter: { card: "summary", title: o.title, description: o.description }
  };
}

// Escape "<" so structured data can never close the script element.
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) }))
  };
}

export function slugifyNiche(n: string): string {
  return n.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
