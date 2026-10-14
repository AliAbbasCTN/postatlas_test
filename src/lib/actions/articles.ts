"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSuperAdmin } from "@/lib/auth";
import { guarded } from "@/lib/action-utils";
import { logAudit } from "@/lib/audit";
import { text, uuid, containsActiveMarkup, ValidationError } from "@/lib/validation";

function slugify(title: string) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

// Blog articles (public marketing content). Super Admin only. Approved Write-for-Us submissions
// arrive by email and are entered here by a human; there is no path from the public form to this table.
export async function createArticleDraft(formData: FormData) {
  return guarded(async () => {
    const { user } = await actionSuperAdmin();
    const title = text(formData, "title", "Title", { min: 5, max: 160 });
    const content = text(formData, "content", "Content", { min: 50, max: 100_000, multiline: true });
    const excerpt = text(formData, "excerpt", "Excerpt", { max: 300, optional: true, multiline: true });
    const author = text(formData, "author_name", "Author", { max: 100, optional: true });
    const metaTitle = text(formData, "meta_title", "Meta title", { max: 70, optional: true });
    const metaDescription = text(formData, "meta_description", "Meta description", { max: 170, optional: true });
    if ([title, content, excerpt, author].some(containsActiveMarkup)) throw new ValidationError("Scripts and active HTML are not allowed. Articles are plain text.");
    const slug = slugify(title);
    if (!slug) throw new ValidationError("The title needs some letters or numbers.");
    const { data, error } = await createAdminClient().from("articles").insert({
      title, slug, content, excerpt: excerpt || null, author_name: author || null,
      meta_title: metaTitle || title, meta_description: metaDescription || null, status: "DRAFT"
    }).select("id").single();
    if (error || !data) return { error: "Could not create the draft. The title may already be in use." };
    await logAudit({ actorId: user.id, action: "article.draft_created", resourceType: "article", resourceId: data.id });
    revalidatePath("/admin/articles");
    return { ok: true as const, id: data.id as string };
  });
}

export async function publishArticle(formData: FormData) {
  return guarded(async () => {
    const { user } = await actionSuperAdmin();
    const id = uuid(formData, "article_id");
    const { error } = await createAdminClient().from("articles").update({ status: "PUBLISHED", published_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: "Could not publish the article." };
    await logAudit({ actorId: user.id, action: "article.published", resourceType: "article", resourceId: id });
    revalidatePath("/admin/articles"); revalidatePath("/blog"); revalidatePath("/sitemap.xml");
    return { ok: true as const };
  });
}

export async function unpublishArticle(formData: FormData) {
  return guarded(async () => {
    const { user } = await actionSuperAdmin();
    const id = uuid(formData, "article_id");
    const { error } = await createAdminClient().from("articles").update({ status: "UNPUBLISHED" }).eq("id", id);
    if (error) return { error: "Could not unpublish the article." };
    await logAudit({ actorId: user.id, action: "article.unpublished", resourceType: "article", resourceId: id });
    revalidatePath("/admin/articles"); revalidatePath("/blog"); revalidatePath("/sitemap.xml");
    return { ok: true as const };
  });
}
