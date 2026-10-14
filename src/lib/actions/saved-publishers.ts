"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/validation";

export async function toggleSavedPublisher(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session?.org) return;
  const websiteId = String(formData.get("website_id") ?? "");
  if (!isUuid(websiteId)) return;
  const saved = String(formData.get("currently_saved") ?? "") === "true";
  const db = createAdminClient();
  if (saved) {
    await db.from("saved_publishers").delete().eq("organization_id", session.org.id).eq("website_id", websiteId);
  } else {
    const { data: listing } = await db.from("publisher_websites").select("id").eq("id", websiteId).eq("status", "approved").maybeSingle();
    if (listing) await db.from("saved_publishers").upsert({ organization_id: session.org.id, website_id: websiteId, saved_by: session.user.id }, { onConflict: "organization_id,website_id", ignoreDuplicates: true });
  }
  revalidatePath("/dashboard/publishers");
}
