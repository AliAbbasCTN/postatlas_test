import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { pageMeta, breadcrumbLd, jsonLdString } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 1800;

async function load(slug: string) {
  const { data } = await createPublicClient().from("articles").select("title, slug, content, excerpt, author_name, published_at, updated_at, meta_title, meta_description").eq("slug", slug).eq("status", "PUBLISHED").maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) return { robots: { index: false, follow: false } };
  return pageMeta({ title: p.meta_title || p.title, description: (p.meta_description || p.excerpt || p.content.slice(0, 155)).slice(0, 160), path: `/blog/${encodeURIComponent(p.slug)}`, type: "article" });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await load(slug);
  if (!post) notFound();
  const path = `/blog/${encodeURIComponent(post.slug)}`;
  const ld = [
    breadcrumbLd([{ name: "Home", path: "/" }, { name: "Resources", path: "/blog" }, { name: post.title, path }]),
    { "@context": "https://schema.org", "@type": "Article", headline: post.title, datePublished: post.published_at, dateModified: post.updated_at, mainEntityOfPage: absoluteUrl(path), ...(post.author_name ? { author: { "@type": "Person", name: post.author_name } } : {}), publisher: { "@type": "Organization", name: "PostAtlas" } }
  ];
  return (
    <section className="py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="max-w-[1000px] mx-auto px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-inksoft mb-4"><Link href="/">Home</Link> / <Link href="/blog">Resources</Link></nav>
        <article className="max-w-[70ch]">
          <h1 className="font-serif font-bold text-4xl mb-2">{post.title}</h1>
          <p className="text-inksoft text-sm mb-8">{post.author_name ? `By ${post.author_name} · ` : ""}{post.published_at ? new Date(post.published_at).toLocaleDateString("en-US") : ""}</p>
          {/* Plain text, never HTML: React escapes it, so stored content cannot inject markup. */}
          <div className="whitespace-pre-wrap leading-relaxed text-inksoft break-words">{post.content}</div>
        </article>
        <p className="mt-10 text-sm"><Link className="underline text-verdigrisdark" href="/authority-audit">See how PostAtlas finds the pages that need links</Link></p>
      </div>
    </section>
  );
}
