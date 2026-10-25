import type { Metadata } from "next";
import { absoluteUrl, indexingAllowed } from "./site";

export const SITE_NAME = "PostAtlas";

// The root layout appends " | PostAtlas" to page titles. A title that already contains the brand is therefore emitted as an
// ABSOLUTE title so the brand never appears twice (the test deployment showed "PostAtlas - ... | PostAtlas").
export const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630, alt: "PostAtlas: find, buy and keep relevant backlinks" };

export function pageMeta(o: { title: string; description: string; path: string; noindex?: boolean; type?: "website" | "article" }): Metadata {
  const url = absoluteUrl(o.path);
  const title = /postatlas/i.test(o.title) ? { absolute: o.title } : o.title;
  const shown = typeof title === "string" ? `${o.title} | ${SITE_NAME}` : o.title;
  return {
    title,
    description: o.description,
    alternates: { canonical: url },
    robots: o.noindex || !indexingAllowed() ? { index: false, follow: false } : undefined,
    openGraph: { title: shown, description: o.description, url, siteName: SITE_NAME, type: o.type ?? "website", locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: shown, description: o.description, images: [OG_IMAGE.url] }
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
