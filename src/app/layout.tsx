import type { Metadata, Viewport } from "next";
import "./globals.css";
import { siteUrl, indexingAllowed } from "@/lib/site";
import { OG_IMAGE } from "@/lib/seo";

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "PostAtlas: guest post and backlink marketplace with verified placements", template: "%s | PostAtlas" },
  description: "Buy guest posts and link insertions on approved publisher websites. PostAtlas shows the price up front, verifies every link is live and keeps monitoring it.",
  applicationName: "PostAtlas",
  // Test, preview and local hosts are never indexed (see src/lib/site-env.ts); production domains are.
  robots: indexingAllowed() ? undefined : { index: false, follow: false },
  openGraph: { siteName: "PostAtlas", type: "website", locale: "en_US", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [OG_IMAGE.url] }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Fonts: connect early and load the stylesheet from <head> (it used to be a CSS @import, which delays discovery). display=swap keeps text visible. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
