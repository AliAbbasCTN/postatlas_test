import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishArticle, unpublishArticle } from "@/lib/actions/articles";
import { StatusBadge } from "@/components/StatusBadge";
import { FormFeedback } from "@/components/FormFeedback";

export default async function AdminArticlesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  await requireSuperAdmin();
  const db = createAdminClient();
  const { data: articles } = await db.from("articles").select("*").order("updated_at", { ascending: false });

  async function publishAction(formData: FormData) {
    "use server";
    const result = await publishArticle(formData);
    if (result?.error) redirect(`/admin/articles?error=${encodeURIComponent(result.error)}`);
    redirect("/admin/articles?done=1");
  }
  async function unpublishAction(formData: FormData) {
    "use server";
    const result = await unpublishArticle(formData);
    if (result?.error) redirect(`/admin/articles?error=${encodeURIComponent(result.error)}`);
    redirect("/admin/articles?done=1");
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="font-serif font-bold text-3xl">Article CMS</h1>
        <Link href="/admin/articles/new" className="px-4 py-2 bg-ink text-paper rounded text-sm">New Draft</Link>
      </div>
      <FormFeedback error={sp.error} success={sp.done ? "Article updated." : undefined} />

      {(!articles || articles.length === 0) ? (
        <div className="border border-dashed border-line rounded-md p-6 text-inksoft">
          No articles yet. This is where approved Write for Us submissions (received by email) get manually entered and published.
        </div>
      ) : (
        <div className="border-t border-ink">
          {articles.map((a: any) => (
            <div key={a.id} className="flex justify-between items-center py-4 border-b border-line gap-4 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <div className="font-serif font-semibold">{a.title}</div>
                <div className="text-sm text-inksoft">/{a.slug}</div>
              </div>
              <StatusBadge status={a.status} />
              {a.status === "PUBLISHED" ? (
                <form action={unpublishAction}><input type="hidden" name="article_id" value={a.id} /><button className="px-3 py-1.5 border border-line rounded text-sm" type="submit">Unpublish</button></form>
              ) : (
                <form action={publishAction}><input type="hidden" name="article_id" value={a.id} /><button className="px-3 py-1.5 border border-verdigris text-verdigrisdark rounded text-sm" type="submit">Publish</button></form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
