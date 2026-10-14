import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { createArticleDraft } from "@/lib/actions/articles";
import { FormFeedback } from "@/components/FormFeedback";

export default async function NewArticlePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  await requireSuperAdmin();

  async function action(formData: FormData) {
    "use server";
    const result = await createArticleDraft(formData);
    if (result?.error) redirect(`/admin/articles/new?error=${encodeURIComponent(result.error)}`);
    redirect("/admin/articles");
  }

  return (
    <div>
      <h1 className="font-serif font-bold text-3xl mb-8">New article draft</h1>
      <p className="text-inksoft mb-6 max-w-[60ch]">Use this to manually enter an article you&apos;ve approved from a Write for Us email submission, or original PostAtlas editorial content.</p>
      <FormFeedback error={sp.error} />
      <form action={action} className="border border-line rounded-md p-6 max-w-[720px] grid gap-4">
        <div><label className="block text-sm mb-1.5">Title</label><input name="title" required className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <div><label className="block text-sm mb-1.5">Author name</label><input name="author_name" className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <div><label className="block text-sm mb-1.5">Excerpt</label><textarea name="excerpt" rows={2} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <div><label className="block text-sm mb-1.5">Content</label><textarea name="content" required rows={14} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <div><label className="block text-sm mb-1.5">Meta description</label><textarea name="meta_description" rows={2} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
        <button className="px-5 py-2.5 bg-ink text-paper rounded text-sm w-fit" type="submit">Save Draft</button>
      </form>
    </div>
  );
}
