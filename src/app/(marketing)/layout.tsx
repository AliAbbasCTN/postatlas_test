import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { jsonLdString } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import { organizationLd, websiteLd } from "@/lib/seo-schema";

// No cookies are read here, so marketing pages can be statically rendered and cached.
// Organization and WebSite structured data are emitted once for every public page (not for the private dashboards).
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const base = absoluteUrl("/").replace(/\/$/, "");
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString([organizationLd(base), websiteLd(base)]) }} />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
