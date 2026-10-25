import { SeoLanding } from "@/components/SeoLanding";
import { pageMeta } from "@/lib/seo";
import { LANDINGS } from "@/lib/landing-pages";

const page = LANDINGS["/guest-post-vs-link-insertion"];
export const metadata = pageMeta({ title: page.metaTitle, description: page.metaDescription, path: page.path, type: page.kind === "article" ? "article" : "website" });

export default function Page() {
  return <SeoLanding page={page} />;
}
