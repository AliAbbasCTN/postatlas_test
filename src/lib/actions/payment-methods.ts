"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionSuperAdmin } from "@/lib/auth";
import { guarded, withRedirect, ActionError } from "@/lib/action-utils";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { text, uuid } from "@/lib/validation";

// Payment instructions (bank/wallet details shown to customers) are controlled by Super Admin only.
export async function createPaymentMethod(formData: FormData) {
  return guarded(async () => {
    const { user } = await actionSuperAdmin();
    const name = text(formData, "name", "Name", { max: 80 });
    const account = text(formData, "account_identifier", "Account details", { max: 300 });
    const instructions = text(formData, "instructions", "Instructions", { max: 1000, optional: true, multiline: true });
    const { error } = await createAdminClient().from("payment_methods").insert({ name, account_identifier: account, instructions: instructions || null, enabled: true });
    if (error) return { error: "Could not create the payment method." };
    await logAudit({ actorId: user.id, action: "payment_method.created", resourceType: "payment_method" });
    revalidatePath("/admin/settings");
    return { ok: true as const };
  });
}

export async function togglePaymentMethod(formData: FormData) {
  return guarded(async () => {
    const { user } = await actionSuperAdmin();
    const id = uuid(formData, "method_id");
    const enabled = String(formData.get("enabled") ?? "") === "true";
    const { error } = await createAdminClient().from("payment_methods").update({ enabled: !enabled }).eq("id", id);
    if (error) return { error: "Could not update the payment method." };
    await logAudit({ actorId: user.id, action: enabled ? "payment_method.disabled" : "payment_method.enabled", resourceType: "payment_method", resourceId: id });
    revalidatePath("/admin/settings");
    return { ok: true as const };
  });
}

// Which currencies a method REALLY accepts. Only a super admin can change it, and only these two are possible.
export async function setMethodCurrencies(formData: FormData) {
  return withRedirect("/admin/finance", async () => {
    const { user } = await actionSuperAdmin();
    const id = uuid(formData, "id");
    const currencies = [formData.get("usd") ? "USD" : null, formData.get("pkr") ? "PKR" : null].filter((c): c is string => !!c);
    if (currencies.length === 0) throw new ActionError("Choose at least one currency (or disable the method instead).");
    const { error } = await createAdminClient().from("payment_methods").update({ currencies }).eq("id", id);
    if (error) throw new ActionError("Could not update the payment method.");
    await logAudit({ actorId: user.id, action: "payment_method.currencies", resourceType: "payment_method", resourceId: id, metadata: { currencies: currencies.join(",") } });
    revalidatePath("/admin/finance");
    redirect("/admin/finance?done=1");
  });
}
