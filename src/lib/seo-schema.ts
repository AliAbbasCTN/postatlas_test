// Pure structured-data builders (schema.org JSON-LD). Every value comes from visible page content or site configuration; nothing is
// invented (no ratings, no reviews, no addresses, no phone numbers, no social profiles that do not exist).
export type Crumb = { name: string; path: string };
export type Faq = { q: string; a: string };

export const organizationLd = (base: string) => ({
  "@context": "https://schema.org", "@type": "Organization", "@id": `${base}/#organization`,
  name: "PostAtlas", url: `${base}/`, logo: { "@type": "ImageObject", url: `${base}/apple-touch-icon.png`, width: 180, height: 180 }
});

export const websiteLd = (base: string) => ({
  "@context": "https://schema.org", "@type": "WebSite", "@id": `${base}/#website`,
  name: "PostAtlas", url: `${base}/`, publisher: { "@id": `${base}/#organization` }, inLanguage: "en"
});

export const breadcrumbListLd = (base: string, items: Crumb[]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${base}${it.path}` }))
});

export const faqLd = (faqs: Faq[]) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
});

// A Service describes what the page really offers. No price, rating or area-served claims are made.
export const serviceLd = (base: string, o: { name: string; description: string; path: string; serviceType: string }) => ({
  "@context": "https://schema.org", "@type": "Service", name: o.name, description: o.description, serviceType: o.serviceType,
  url: `${base}${o.path}`, provider: { "@id": `${base}/#organization` }
});

export const articleLd = (base: string, o: { headline: string; description: string; path: string; datePublished: string; dateModified: string }) => ({
  "@context": "https://schema.org", "@type": "Article", headline: o.headline, description: o.description,
  mainEntityOfPage: `${base}${o.path}`, datePublished: o.datePublished, dateModified: o.dateModified,
  author: { "@id": `${base}/#organization` }, publisher: { "@id": `${base}/#organization` }
});
