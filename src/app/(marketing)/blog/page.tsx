import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { pageMeta } from "@/lib/seo";
import { Pagination, parsePage } from "@/components/ui";

export const revalidate = 1800;
const PAGE = 20;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  return pageMeta({ title: page > 1 ? `Resources (page ${page})` : "Resources on link building and verification", description: "Practical notes on finding link opportunities, working with publishers and keeping placements healthy.", path: page > 1 ? `/blog?page=${page}` : "/blog" });
}

export default async function BlogIndexPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { data: posts, count } = await createPublicClient().from("articles").select("id, title, slug, excerpt, published_at", { count: "exact" }).eq("status", "PUBLISHED").order("published_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  return (
    <section className="py-14">
      <div className="max-w-[1000px] mx-auto px-6">
        <h1 className="font-serif font-bold text-4xl mb-10 max-w-[40ch]">Resources on link building, verification and publisher work</h1>
        {(!posts || posts.length === 0) && <div className="border border-dashed border-line rounded-md p-8 text-inksoft"><strong className="block font-serif text-ink text-lg mb-1.5">No articles yet</strong>Articles will appear here once they are published. In the meantime, see <Link className="underline text-accenttext" href="/how-it-works">how PostAtlas works</Link>.</div>}
        {posts?.map((p: any) => (
          <article key={p.id} className="grid sm:grid-cols-[140px_1fr] gap-2 sm:gap-6 py-6 border-b border-line">
            <time dateTime={p.published_at ?? undefined} className="font-mono text-xs text-inksoft">{p.published_at ? new Date(p.published_at).toLocaleDateString("en-US") : ""}</time>
            <div><h2 className="mb-1.5"><Link href={`/blog/${encodeURIComponent(p.slug)}`} className="font-serif font-semibold text-lg">{p.title}</Link></h2><p className="text-inksoft">{p.excerpt}</p></div>
          </article>
        ))}
        <Pagination basePath="/blog" page={page} pageSize={PAGE} total={count ?? 0} />
      </div>
    </section>
  );
}
