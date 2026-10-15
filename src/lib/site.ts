// The canonical origin used in sitemaps, robots, canonical links and emails.

function normalizeOrigin(raw: string): string {
  const url = new URL(raw);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SITE_URL must use HTTP or HTTPS.");
  }

  return url.origin;
}

export function siteUrl(): string {
  const configured = process.env.SITE_URL?.trim();

  if (configured) {
    return normalizeOrigin(configured);
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();

  if (process.env.VERCEL && vercelUrl) {
    return normalizeOrigin(`https://${vercelUrl}`);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SITE_URL is missing. Set SITE_URL or deploy with VERCEL_URL."
    );
  }

  return "http://localhost:3000";
}