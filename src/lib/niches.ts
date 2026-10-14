// Shared category list for websites, opportunities and publisher listings.
// Prohibited categories (gambling, CBD, vape, link networks) are deliberately absent.
export const NICHES = [
  "SEO & Marketing", "Technology", "Business", "Finance", "Health & Wellness",
  "Travel", "Education", "Lifestyle", "E-commerce", "Real Estate", "Other"
] as const;
export type Niche = (typeof NICHES)[number];
